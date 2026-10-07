// Text from outside goes into a prompt inside a tag.
// The text can hold a close tag that ends the tag early,
// so `escapeXml` replaces each `<`, which starts each tag, before the text goes in.

/** `text` with `<` as `&lt;`, so that it cannot close or open a tag. */
export const escapeXml = (text) => String(text).replaceAll("<", "&lt;");
