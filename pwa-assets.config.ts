// Settings for `npm run icons` (@vite-pwa/assets-generator): turns
// public/icon.svg into the PNG icons and favicon a PWA needs. The generated
// files are committed, so builds don't depend on the generator.
import {
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // iOS shows the apple-touch-icon on a black square if it has transparency;
    // the source is already opaque, so no padding is added.
    apple: { ...minimal2023Preset.apple, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0 },
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
  },
  images: ['public/icon.svg'],
})
