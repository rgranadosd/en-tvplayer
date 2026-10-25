#!/usr/bin/env python3
"""Install and launch the newest signed EN IPTV widget over Samsung SDB."""

import re
import socket
import struct
import sys
import time
import zipfile
from pathlib import Path

PORT = 26101
MAX_DATA = 4096
ROOT = Path(__file__).resolve().parent.parent


class Sdb:
    def __init__(self, host):
        self.socket = socket.create_connection((host, PORT), timeout=15)
        self.buffer = b""
        self.next_id = 1
        self.okay = {}
        self.inbox = {}
        self.closed = set()
        self.send(b"CNXN", 0x01000000, MAX_DATA, b"host::\0")
        command, _, max_data, data = self.read()
        if command != b"CNXN":
            raise ConnectionError(f"TV returned {command!r} instead of connecting")
        self.max_data = min(max_data, MAX_DATA)
        self.banner = data.rstrip(b"\0").decode("utf-8", "replace")

    def send(self, command, arg0, arg1, data=b""):
        command_number = struct.unpack("<I", command)[0]
        header = struct.pack(
            "<6I",
            command_number,
            arg0,
            arg1,
            len(data),
            sum(data) & 0xFFFFFFFF,
            command_number ^ 0xFFFFFFFF,
        )
        self.socket.sendall(header + data)

    def receive(self, size):
        while len(self.buffer) < size:
            chunk = self.socket.recv(65536)
            if not chunk:
                raise ConnectionError("TV closed the connection")
            self.buffer += chunk
        result, self.buffer = self.buffer[:size], self.buffer[size:]
        return result

    def read(self):
        command, arg0, arg1, size, _, _ = struct.unpack("<6I", self.receive(24))
        return struct.pack("<I", command), arg0, arg1, self.receive(size) if size else b""

    def pump(self):
        command, remote, local, data = self.read()
        if command == b"OKAY":
            self.okay[local] = remote
        elif command == b"WRTE":
            self.inbox[local] = self.inbox.get(local, b"") + data
            self.send(b"OKAY", local, remote)
        elif command == b"CLSE":
            self.closed.add(local)

    def open(self, service):
        local = self.next_id
        self.next_id += 1
        self.send(b"OPEN", local, 0, service.encode() + b"\0")
        while local not in self.okay:
            if local in self.closed:
                raise ConnectionError(f"TV refused {service}")
            self.pump()
        return local, self.okay.pop(local)

    def write(self, stream, data):
        local, remote = stream
        self.send(b"WRTE", local, remote, data)
        while local not in self.okay:
            if local in self.closed:
                raise ConnectionError("TV closed the stream")
            self.pump()
        del self.okay[local]

    def read_until(self, stream, pattern=None, seconds=20):
        local = stream[0]
        deadline = time.time() + seconds
        while time.time() < deadline and local not in self.closed:
            current = self.inbox.get(local, b"").decode("utf-8", "replace")
            if pattern and re.search(pattern, current):
                break
            self.socket.settimeout(max(0.1, deadline - time.time()))
            try:
                self.pump()
            except socket.timeout:
                break
        self.socket.settimeout(15)
        return self.inbox.pop(local, b"").decode("utf-8", "replace")

    def shell(self, command, pattern=None, seconds=20):
        return self.read_until(self.open("shell:" + command), pattern, seconds)

    def capabilities(self):
        text = self.read_until(self.open("capability:"), seconds=5)
        return dict(line.split(":", 1) for line in text.splitlines() if ":" in line)

    def push(self, remote_path, data):
        stream = self.open("sync:")
        spec = f"{remote_path},{0o100644}".encode()
        self.write(stream, b"SEND" + struct.pack("<I", len(spec)) + spec)
        step = self.max_data - 8
        for offset in range(0, len(data), step):
            part = data[offset : offset + step]
            self.write(stream, b"DATA" + struct.pack("<I", len(part)) + part)
        self.write(stream, b"DONE" + struct.pack("<I", int(time.time())))
        answer = self.read_until(stream, seconds=60).encode()
        if answer[:4] != b"OKAY":
            raise ConnectionError("TV did not accept the widget")


def newest_widget(legacy):
    """The newest package for this TV: the legacy build (`_tizen24` in its name) for Tizen 2.4/3, the other for 4+."""
    widgets = [
        path
        for path in [*ROOT.glob("beta/*.wgt"), *ROOT.glob("stable/*.wgt")]
        if ("_tizen24_" in path.name) == legacy
    ]
    if not widgets:
        script = "tizen:legacy" if legacy else "tizen"
        raise SystemExit(f"Build first with: TIZEN_CERT_PROFILE=<profile> npm run {script}")
    return max(widgets, key=lambda path: path.stat().st_mtime)


def is_legacy(platform_version):
    try:
        return float(".".join(platform_version.split(".")[:2])) < 4.0
    except ValueError:
        return False


def read_manifest(widget):
    with zipfile.ZipFile(widget) as archive:
        names = set(archive.namelist())
        if not {"author-signature.xml", "signature1.xml"}.issubset(names):
            raise SystemExit(
                "Widget is not Samsung-signed. Rebuild with TIZEN_CERT_PROFILE=<profile>."
            )
        return archive.read("config.xml").decode("utf-8")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 tizen/install.py <TV-IP>")

    client = Sdb(sys.argv[1])
    capabilities = client.capabilities()
    widget = newest_widget(is_legacy(capabilities.get("platform_version", "")))
    manifest = read_manifest(widget)
    application = re.search(r"<tizen:application[^>]*>", manifest).group(0)
    app_id = re.search(r'\bid="([^"]+)"', application).group(1)
    package_id = re.search(r'\bpackage="([^"]+)"', application).group(1)
    remote = capabilities.get("sdk_toolpath", "/home/owner/share/tmp/sdk_tools").rstrip("/")
    remote += f"/{widget.name}"

    print(f"Connected to {client.banner}; Tizen {capabilities.get('platform_version', '?')}")
    print(f"Copying {widget.name}...")
    client.push(remote, widget.read_bytes())
    print("Installing...")
    result = client.shell(f"0 vd_appinstall {package_id} {remote}", r"spend time", 120)
    if "install completed" not in result:
        raise SystemExit("TV did not complete the installation:\n" + result.strip())
    launch = client.shell(f"0 was_execute {app_id}", r"launched|spend time", 20)
    if "launched" not in launch:
        raise SystemExit("Installed, but TV did not confirm launch:\n" + launch.strip())
    print("EN IPTV installed and launched.")


if __name__ == "__main__":
    main()
