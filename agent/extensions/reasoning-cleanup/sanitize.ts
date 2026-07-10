const EMPTY_HTML_COMMENT = /[ \t]*<!--\s*-->[ \t]*/g;

export function stripEmptyHtmlComments(text: string): string {
	if (!EMPTY_HTML_COMMENT.test(text)) return text;
	EMPTY_HTML_COMMENT.lastIndex = 0;
	return text.replace(EMPTY_HTML_COMMENT, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}
