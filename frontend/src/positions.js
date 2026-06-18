// StatsBomb full position name -> short code for compact display (LB, CF, ...)
const POSITION_ABBR = {
  'Goalkeeper': 'GK',
  'Right Back': 'RB',
  'Right Center Back': 'RCB',
  'Center Back': 'CB',
  'Left Center Back': 'LCB',
  'Left Back': 'LB',
  'Right Wing Back': 'RWB',
  'Left Wing Back': 'LWB',
  'Right Defensive Midfield': 'RDM',
  'Center Defensive Midfield': 'CDM',
  'Left Defensive Midfield': 'LDM',
  'Right Center Midfield': 'RCM',
  'Center Midfield': 'CM',
  'Left Center Midfield': 'LCM',
  'Right Midfield': 'RM',
  'Left Midfield': 'LM',
  'Right Attacking Midfield': 'RAM',
  'Center Attacking Midfield': 'CAM',
  'Left Attacking Midfield': 'LAM',
  'Right Wing': 'RW',
  'Left Wing': 'LW',
  'Right Center Forward': 'RCF',
  'Center Forward': 'CF',
  'Left Center Forward': 'LCF',
  'Striker': 'ST',
  'Secondary Striker': 'SS',
}

export function positionAbbr(pos) {
  if (!pos) return ''
  if (POSITION_ABBR[pos]) return POSITION_ABBR[pos]
  // fallback: first letter of each word (e.g. an unmapped position)
  return pos.split(' ').map(w => w[0]).join('').toUpperCase()
}
