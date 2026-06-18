// flagcdn.com country codes for all 32 World Cup 2022 nations
// (keyed by StatsBomb team name).
export const FLAG_CODES = {
  'Qatar': 'qa',
  'Ecuador': 'ec',
  'Senegal': 'sn',
  'Netherlands': 'nl',
  'England': 'gb-eng',
  'Iran': 'ir',
  'United States': 'us',
  'Wales': 'gb-wls',
  'Argentina': 'ar',
  'Saudi Arabia': 'sa',
  'Mexico': 'mx',
  'Poland': 'pl',
  'France': 'fr',
  'Australia': 'au',
  'Denmark': 'dk',
  'Tunisia': 'tn',
  'Spain': 'es',
  'Costa Rica': 'cr',
  'Germany': 'de',
  'Japan': 'jp',
  'Belgium': 'be',
  'Canada': 'ca',
  'Morocco': 'ma',
  'Croatia': 'hr',
  'Brazil': 'br',
  'Serbia': 'rs',
  'Switzerland': 'ch',
  'Cameroon': 'cm',
  'Portugal': 'pt',
  'Ghana': 'gh',
  'Uruguay': 'uy',
  'South Korea': 'kr',
}

export function flagUrl(teamName, width = 40) {
  const code = FLAG_CODES[teamName]
  return code ? `https://flagcdn.com/w${width}/${code}.png` : null
}

// FIFA 3-letter team codes for the broadcast scorebug
export const TEAM_ABBR = {
  'Qatar': 'QAT', 'Ecuador': 'ECU', 'Senegal': 'SEN', 'Netherlands': 'NED',
  'England': 'ENG', 'Iran': 'IRN', 'United States': 'USA', 'Wales': 'WAL',
  'Argentina': 'ARG', 'Saudi Arabia': 'KSA', 'Mexico': 'MEX', 'Poland': 'POL',
  'France': 'FRA', 'Australia': 'AUS', 'Denmark': 'DEN', 'Tunisia': 'TUN',
  'Spain': 'ESP', 'Costa Rica': 'CRC', 'Germany': 'GER', 'Japan': 'JPN',
  'Belgium': 'BEL', 'Canada': 'CAN', 'Morocco': 'MAR', 'Croatia': 'CRO',
  'Brazil': 'BRA', 'Serbia': 'SRB', 'Switzerland': 'SUI', 'Cameroon': 'CMR',
  'Portugal': 'POR', 'Ghana': 'GHA', 'Uruguay': 'URU', 'South Korea': 'KOR',
}

export function teamAbbr(teamName) {
  if (!teamName) return '???'
  return TEAM_ABBR[teamName] || teamName.slice(0, 3).toUpperCase()
}
