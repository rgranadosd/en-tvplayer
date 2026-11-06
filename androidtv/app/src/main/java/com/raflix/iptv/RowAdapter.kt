package com.raflix.iptv

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

/**
 * A sidebar list driven by the remote (ui.js renderChannelList / renderGroupList): the app moves a highlighted row
 * with Up/Down and keeps it in view, rather than Android's own focus. One adapter for channels, groups and the menu:
 * a row is a title, an optional left mark and an optional second line.
 */
class Row(val mark: String, val title: String, val detail: String, val playing: Boolean = false)

class RowAdapter : RecyclerView.Adapter<RowAdapter.Holder>() {

    private var rows: List<Row> = emptyList()
    var focused = -1
        private set

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val mark: TextView = view.findViewById(R.id.row_mark)
        val title: TextView = view.findViewById(R.id.row_title)
        val detail: TextView = view.findViewById(R.id.row_detail)
    }

    fun submit(list: List<Row>, focus: Int) {
        rows = list
        focused = focus.coerceIn(-1, list.size - 1)
        notifyDataSetChanged()
    }

    fun setFocused(index: Int) {
        if (rows.isEmpty()) return
        val next = index.coerceIn(0, rows.size - 1)
        val prev = focused
        focused = next
        if (prev in rows.indices) notifyItemChanged(prev)
        notifyItemChanged(next)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(LayoutInflater.from(parent.context).inflate(R.layout.item_row, parent, false))

    override fun getItemCount() = rows.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val row = rows[position]
        holder.mark.text = row.mark
        holder.mark.visibility = if (row.mark.isEmpty()) View.GONE else View.VISIBLE
        holder.title.text = row.title
        holder.detail.text = row.detail
        holder.detail.visibility = if (row.detail.isEmpty()) View.GONE else View.VISIBLE
        holder.itemView.isSelected = position == focused
        holder.itemView.isActivated = row.playing
    }

    companion object {
        /** Keeps the highlighted row in the middle of the list (ui.js nearestScrollTop). */
        fun reveal(list: RecyclerView, index: Int) {
            val lm = list.layoutManager as? LinearLayoutManager ?: return
            val rowHeight = list.getChildAt(0)?.height ?: return list.scrollToPosition(index)
            lm.scrollToPositionWithOffset(index, (list.height - rowHeight) / 2)
        }
    }
}
