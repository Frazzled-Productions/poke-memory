---
kind: fixed
---
- Number formatting and pluralisation now respect the active locale. Counts on the Stats, Journey, Settings, and Pokédex pages were previously hardcoded to `en-GB`; review counts, card counts, streak labels, and similar strings are now formatted with `Intl.NumberFormat` (via `useFormatter` from next-intl) and pluralised with ICU plural rules in all supported languages, fixing grammatically incorrect output in Japanese, Simplified Chinese, and Traditional Chinese.
