export function shuffleAnagram(word: string, random: () => number = Math.random): string {
  const chars = [...word];
  if (chars.length < 2) return word;
  if (new Set(chars).size === 1) return word;
  let out = word;
  for (let attempt = 0; attempt < 20 && out === word; attempt++) {
    const a = [...chars];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    out = a.join("");
  }
  if (out === word) {
    // 決定的な random でも必ず元と異なるように末尾2文字を入れ替える
    const a = [...chars];
    [a[a.length - 1], a[a.length - 2]] = [a[a.length - 2], a[a.length - 1]];
    out = a.join("");
  }
  return out;
}
