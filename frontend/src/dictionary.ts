import type { DictionarySnapshot, DictionaryUpdate, DictionaryWord } from "./domain";
import { dictionaryCaseFolding, dictionaryLimits } from "./generated/dictionary-rules";
export { dictionaryLimits } from "./generated/dictionary-rules";

export const emptyDictionary: DictionarySnapshot = { revision: 0, entries: [] };
export interface DictionaryDraft {
  baseRevision: number;
  entries: (Omit<DictionaryWord, "variants"> & { variantsText: string })[];
}

export function draftDictionary(snapshot: DictionarySnapshot): DictionaryDraft {
  return { baseRevision: snapshot.revision, entries: snapshot.entries.map(entry => ({
    term: entry.term, reading: entry.reading ?? "", variantsText: (entry.variants ?? []).join("\n"), enabled: entry.enabled ?? true,
  })) };
}

export function dictionaryUpdate(draft: DictionaryDraft): DictionaryUpdate {
  return { base_revision: draft.baseRevision, entries: draft.entries.map(entry => ({
    term: entry.term.trim().normalize("NFC"), reading: entry.reading.trim().normalize("NFC"), enabled: entry.enabled,
    variants: entry.variantsText.split(/\r?\n/).map(value => value.trim().normalize("NFC")).filter(Boolean),
  })) };
}

export function dictionaryValidation(draft: DictionaryDraft): string {
  const { entries } = dictionaryUpdate(draft);
  if (entries.length > dictionaryLimits.maxEntries) return `単語は${dictionaryLimits.maxEntries}件まで登録できます。`;
  const terms = new Set<string>();
  let total = 0;
  for (const [index, word] of entries.entries()) {
    const label = `${index + 1}件目`;
    if (!word.term) return `${label}の表記を入力してください。`;
    const values = [word.term, word.reading, ...word.variants];
    if (values.some(value => Array.from(value).length > dictionaryLimits.maxWordLength)) return `${label}は各欄${dictionaryLimits.maxWordLength}文字以内で入力してください。`;
    if (values.some(value => /[\x00-\x1f\x7f<>]/.test(value))) return `${label}に改行や < > は使えません。誤認識の表記は1行ずつ入力してください。`;
    if (word.variants.length > dictionaryLimits.maxVariants) return `${label}の誤認識の表記は${dictionaryLimits.maxVariants}件以内で入力してください。`;
    if (new Set(word.variants).size !== word.variants.length) return `${label}の誤認識の表記が重複しています。`;
    const key = Array.from(word.term.normalize("NFKC"), character => dictionaryCaseFolding[character] ?? character).join("");
    if (terms.has(key)) return `${label}の表記は登録済みです。同じ表記は一度だけ登録してください。`;
    terms.add(key);
    total += values.reduce((sum, value) => sum + Array.from(value).length, 0);
  }
  return total > dictionaryLimits.maxTotalLength ? `辞書は合計${dictionaryLimits.maxTotalLength.toLocaleString("ja-JP")}文字以内で登録してください。` : "";
}
