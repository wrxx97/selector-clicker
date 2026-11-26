import { findKeys } from "i18next-cli";
import english from "../i18n/locales/en/translation.json";
import simplifiedChinese from "../i18n/locales/zh-CN/translation.json";

const catalogs: Record<string, Record<string, string>> = { en: english, "zh-CN": simplifiedChinese };
const locales = Object.keys(catalogs);
const { allKeys } = await findKeys({
  locales,
  extract: {
    input: "src/**/*.{ts,tsx}",
    primaryLanguage: "en",
    output: "src/i18n/locales/{{language}}/{{namespace}}.json",
    functions: ["t", "*.t", "translate", "setStatus", "setTitle", "startLanguage"]
  }
});

const placeholderNames = (message: string) =>
  [...new Set(Array.from(message.matchAll(/{{\s*([^\s,}]+)/g), ([, name]) => name))].sort().join(", ");
const pluralSuffix = /_(?:ordinal_)?(zero|one|two|few|many|other)$/;
const errors = new Set<string>();

for (const [locale, catalog] of Object.entries(catalogs)) {
  const pluralRules = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const required = new Set<string>();

  // Catalog-only keys include dynamic feedback and manifest metadata.
  for (const key of Object.keys(english)) {
    const plural = key.match(pluralSuffix)?.[1];
    if (!plural || pluralRules.some((category) => category === plural)) required.add(key);
  }

  for (const { key, hasCount, isOrdinal } of allKeys.values()) {
    if (hasCount) {
      const type = isOrdinal ? "ordinal" : "cardinal";
      const categories = new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
      // The extractor reports plural entries with their generated suffixes.
      const baseKey = key.replace(pluralSuffix, "");
      for (const category of categories) required.add(`${baseKey}${isOrdinal ? "_ordinal" : ""}_${category}`);
    } else {
      required.add(key);
    }
  }

  for (const key of required) {
    const message = catalog[key];
    if (!message?.trim()) {
      errors.add(`${locale}: missing translation for ${key}`);
      continue;
    }
    const reference = catalogs.en[key];
    if (reference && placeholderNames(message) !== placeholderNames(reference)) {
      errors.add(`${locale}: placeholders for ${key} differ from English`);
    }
  }
}

if (errors.size) {
  console.error([...errors].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${allKeys.size} extracted keys and both translation catalogs.`);
}
