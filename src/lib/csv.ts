/**
 * CSV field escaping.
 *
 * Quoting alone does NOT stop Excel or Google Sheets evaluating a field that
 * begins with = + - @ tab or CR. Post titles come from platform captions and
 * these exports are emailed to sponsors, so a caption is an injection vector
 * into the client's commercial contacts.
 */
export function escapeCsvField(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${v.replace(/"/g, '""')}"`;
}
