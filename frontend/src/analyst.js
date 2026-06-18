// The four FirstTouch analyst personas. Granite does the talking; these are the
// faces and identities of each voice. `code` is the language sent to the backend,
// which picks the matching persona prompt. Avatars live in /public/avatars/.
export const ANALYSTS = {
  en: {
    code: 'en', language: 'English', flag: 'gb',
    name: 'Nathan', role: 'Tactical Analyst',
    model: 'IBM Granite', face: '/avatars/nathan',
  },
  es: {
    code: 'es', language: 'Español', flag: 'es',
    name: 'Valeria', role: 'Analista Táctica',
    model: 'IBM Granite', face: '/avatars/valeria',
  },
  fr: {
    code: 'fr', language: 'Français', flag: 'fr',
    name: 'Claire', role: 'Analyste Tactique',
    model: 'IBM Granite', face: '/avatars/claire',
  },
  de: {
    code: 'de', language: 'Deutsch', flag: 'de',
    name: 'Lukas', role: 'Taktikanalyst',
    model: 'IBM Granite', face: '/avatars/lukas',
  },
}

export const LANGS = ['en', 'es', 'fr', 'de']
export const DEFAULT_LANG = 'en'

export function getAnalyst(code) {
  return ANALYSTS[code] || ANALYSTS[DEFAULT_LANG]
}

// little flag image (works on Windows, unlike flag emoji)
export function flagSrc(code) {
  const f = (ANALYSTS[code] || ANALYSTS[DEFAULT_LANG]).flag
  return `https://flagcdn.com/32x24/${f}.png`
}

// back-compat default export of the English analyst
export const ANALYST = ANALYSTS.en
