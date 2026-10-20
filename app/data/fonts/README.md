# Reading fonts of the reader

Woff2 files of three reading fonts for the reader's "Aa" menu (app/src/ui/reader/reader-styles.js), the Latin and
Latin Extended subsets in the weights 400 and 700, upright and italic. They come from the npm packages of Fontsource
5.3.0 (which take them from Google Fonts) and are kept here so that the app needs no extra dependency:

| Folder | Font | Package | License |
|---|---|---|---|
| literata | Literata (TypeTogether for Google) | @fontsource/literata 5.3.0 | SIL Open Font License 1.1 (OFL.txt) |
| source-serif-4 | Source Serif 4 (Adobe) | @fontsource/source-serif-4 5.3.0 | SIL Open Font License 1.1 (OFL.txt) |
| atkinson-hyperlegible-next | Atkinson Hyperlegible Next (Braille Institute) | @fontsource/atkinson-hyperlegible-next 5.3.0 | SIL Open Font License 1.1 (OFL.txt) |

EB Garamond, the default reading font, comes from @fontsource/eb-garamond (build/vendor.js copies it to
app/vendor/fonts).
