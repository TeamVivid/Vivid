export function parseStoryboards(storyboardData) {
  if (!storyboardData) return null;
  const spec = storyboardData.playerStoryboardSpecRenderer?.spec;
  if (!spec || typeof spec !== 'string') return null;

  const parts = spec.split('|');
  if (parts.length < 2) return null;

  const baseUrlTemplate = parts[0];
  const levels = [];

  for (let i = 1; i < parts.length; i++) {
    const fields = parts[i].split('#');
    if (fields.length < 8) continue;
    const [width, height, count, cols, rows, intervalMs, nameTpl, sigh] = fields;
    const levelIdx = i - 1;
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    const c = parseInt(count, 10);
    const columns = parseInt(cols, 10);
    const r = parseInt(rows, 10);
    const interval = parseInt(intervalMs, 10);
    const framesPerSheet = columns * r;
    const totalSheets = Math.ceil(c / (framesPerSheet || 1));

    const sheets = [];
    for (let s = 0; s < totalSheets; s++) {
      const sheetName = nameTpl.replace('$M', String(s));
      const url = baseUrlTemplate.replace('$L', String(levelIdx)).replace('$N', sheetName) + `&sigh=${sigh}`;
      sheets.push(url);
    }

    levels.push({
      level: levelIdx,
      width: w,
      height: h,
      count: c,
      cols: columns,
      rows: r,
      interval: interval > 0 ? interval : 1000,
      framesPerSheet,
      totalSheets,
      sheets
    });
  }

  if (!levels.length) return null;

  return {
    spec,
    recommendedLevel: Math.min(storyboardData.playerStoryboardSpecRenderer?.recommendedLevel ?? (levels.length - 1), levels.length - 1),
    levels
  };
}

export default { parseStoryboards };
