// Prints what a diagnostic build of the TV app sends (player/diag.local.json → src/diag.js): GET /log?<message>.
//   node scripts/diag-server.mjs [port]      (default 8099)
import http from 'node:http';

const port = parseInt(process.argv[2], 10) || 8099;
http
  .createServer((req, res) => {
    const message = decodeURIComponent(new URL(req.url, 'http://x').search.slice(1).replace(/&_=\d+$/, ''));
    console.log(new Date().toTimeString().slice(0, 8), req.socket.remoteAddress.replace('::ffff:', ''), message);
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
  })
  .listen(port, () =>
    console.log(`diag server on http://0.0.0.0:${port}/log — the TV's diag.local.json must point here`),
  );
