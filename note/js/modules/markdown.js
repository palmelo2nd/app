// (1) インポート — なし
//
// Markdown→HTMLの小さな自作変換（外部ライブラリを使わない＝圏外でも確実に動かすため）。
// 対応：見出し・段落（1行の改行はそのまま改行）・箇条書き（入れ子／番号付き／チェックボックス）・引用・区切り線・
//       コードブロック（「コピー」ボタン付き）・表・インラインコード・太字・取り消し線・リンク・URLの自動リンク。
// 入力はすべてエスケープしてから記法だけをタグに置き換える（ノートに書いたHTMLはそのまま文字として表示する）。

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 行内の記法（エスケープ済みの文字列を受け取らず、生の文字列を受け取ってエスケープしながら変換する）。 */
export function renderInline(raw) {
    const slots = [];
    const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = String(raw ?? '');

    s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
        keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`));
    s = s.replace(/https?:\/\/[^\s<>"'（）「」『』【】、。，．]+/g, (url) =>
        keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`));

    s = escapeHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

const RE_FENCE   = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR      = /^\s*([-*_])(\s*\1){2,}\s*$/;
const RE_LIST    = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_QUOTE   = /^\s*>\s?(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function codeBlock(code, lang) {
    return `<div class="md-code"><button type="button" class="md-copy-btn">コピー</button>`
        + `<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(code)}</code></pre></div>`;
}

function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

/** 箇条書きの行（{indent, ordered, text}の配列）を入れ子のリストにする。 */
function renderList(items) {
    let html = '';
    const stack = []; // { indent, tag }
    items.forEach(item => {
        while (stack.length && item.indent < stack[stack.length - 1].indent) {
            html += `</li></${stack.pop().tag}>`;
        }
        const top = stack[stack.length - 1];
        if (!top || item.indent > top.indent) {
            const tag = item.ordered ? 'ol' : 'ul';
            stack.push({ indent: item.indent, tag });
            html += `<${tag}>`;
        } else {
            html += '</li>';
        }
        const check = item.text.match(/^\[([ xX])\]\s+(.*)$/);
        html += check
            ? `<li class="md-task"><input type="checkbox" disabled${check[1] === ' ' ? '' : ' checked'}> ${renderInline(check[2])}`
            : `<li>${renderInline(item.text)}`;
    });
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return html;
}

/**
 * Markdown文字列をHTMLにする。
 * (2) インプット: src（ノートの本文）
 * (4) アウトプット: HTML文字列
 */
export function renderMarkdown(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let para = [];
    const flushPara = () => {
        if (para.length) html += `<p>${para.map(renderInline).join('<br>')}</p>`;
        para = [];
    };

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        const fence = line.match(RE_FENCE);
        if (fence) {
            flushPara();
            const buf = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
            i++; // 閉じの```（無ければ最後まで）
            html += codeBlock(buf.join('\n'), fence[2]);
            continue;
        }

        if (!line.trim()) { flushPara(); i++; continue; }

        const heading = line.match(RE_HEADING);
        if (heading) {
            flushPara();
            const level = heading[1].length;
            html += `<h${level} class="md-h${level}">${renderInline(heading[2])}</h${level}>`;
            i++;
            continue;
        }

        if (RE_HR.test(line)) { flushPara(); html += '<hr>'; i++; continue; }

        if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
            flushPara();
            const head = splitRow(line);
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
            html += '<div class="md-table-wrap"><table><thead><tr>' + head.map(c => `<th>${renderInline(c)}</th>`).join('')
                + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('')
                + '</tbody></table></div>';
            continue;
        }

        if (RE_QUOTE.test(line)) {
            flushPara();
            const buf = [];
            while (i < lines.length && RE_QUOTE.test(lines[i])) buf.push(lines[i++].match(RE_QUOTE)[1]);
            html += `<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`;
            continue;
        }

        if (RE_LIST.test(line)) {
            flushPara();
            const items = [];
            while (i < lines.length) {
                const m = lines[i].match(RE_LIST);
                if (m) {
                    items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] });
                    i++;
                } else if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
                    items[items.length - 1].text += ' ' + lines[i].trim(); // 字下げされた続きの行
                    i++;
                } else if (!lines[i].trim()) {
                    // 空行をはさんで次の項目が続くなら同じリスト（Notionから書き出した箇条書きは項目ごとに空行が入る）
                    let j = i;
                    while (j < lines.length && !lines[j].trim()) j++;
                    if (j < lines.length && RE_LIST.test(lines[j])) i = j;
                    else break;
                } else {
                    break;
                }
            }
            html += renderList(items);
            continue;
        }

        para.push(line);
        i++;
    }
    flushPara();
    return html;
}
