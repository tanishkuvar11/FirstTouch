// Lightweight UI internationalisation. Keyed by the ENGLISH string, so any
// phrase we miss simply renders in English (graceful fallback). The active
// language comes from LangContext (set in App from the analyst language picker).
import { createContext, useContext } from 'react'

export const LangContext = createContext('en')

const DICT = {
  es: {
    // topbar / app
    'Beyond Highlights, Into Insights': 'Más Allá de los Resúmenes',
    'IBM Granite and watsonx.ai showcase': 'Demostración de IBM Granite y watsonx.ai',
    'Reset': 'Reiniciar',
    // match selector
    'Match': 'Partido',
    'API offline': 'API sin conexión',
    'Select a match…': 'Selecciona un partido…',
    'Loading 64 matches…': 'Cargando 64 partidos…',
    'Search team or stage…': 'Buscar equipo o fase…',
    'No matches found': 'No se encontraron partidos',
    'Group Stage': 'Fase de Grupos',
    'Round of 16': 'Octavos de Final',
    'Quarter-finals': 'Cuartos de Final',
    'Semi-finals': 'Semifinales',
    '3rd Place Final': 'Tercer Puesto',
    'Final': 'Final',
    // event list
    'Events': 'Eventos',
    'All': 'Todos',
    'Goals': 'Goles',
    'Shot': 'Tiro',
    'Pass': 'Pase',
    'Dribble': 'Regate',
    'Defence': 'Defensa',
    'All players': 'Todos los jugadores',
    'Search players…': 'Buscar jugadores…',
    'Select a match to load its events': 'Selecciona un partido para cargar sus eventos',
    'Loading events & 360 frames…': 'Cargando eventos y datos 360…',
    'First load of a match takes a few seconds': 'La primera carga tarda unos segundos',
    // 3D pitch
    'Welcome to FirstTouch': 'Bienvenido a FirstTouch',
    'SELECT MATCH': 'ELIGE UN PARTIDO',
    'FIFA World Cup 2022™ · 64 matches · Full 360° freeze-frame coverage': 'Copa Mundial FIFA 2022™ · 64 partidos · Cobertura completa 360°',
    'PICK A MOMENT': 'ELIGE UN MOMENTO',
    'Choose an event from the list to reconstruct what the player saw': 'Elige un evento de la lista para reconstruir lo que vio el jugador',
    'PRESSURE': 'PRESIÓN',
    'OPEN': 'LIBRES',
    'NEAREST DEF': 'DEF MÁS CERCA',
    'OUTCOME': 'RESULTADO',
    'Open Lane': 'Línea libre',
    'Blocked': 'Bloqueado',
    'Pass Made': 'Pase realizado',
    'Carry Made': 'Conducción',
    'Shot Goal': 'Tiro a gol',
    '🖱 Drag rotate · Right-drag pan · Scroll zoom · Double-click recenter': '🖱 Arrastra para rotar · Clic derecho para mover · Rueda para zoom · Doble clic para centrar',
    'HIGH': 'ALTA', 'MEDIUM': 'MEDIA', 'LOW': 'BAJA',
    'MOMENTUM': 'IMPULSO',
    // decision panel tabs + sections
    'Decision': 'Decisión', 'Profile': 'Perfil', 'Chain': 'Cadena', 'What If': 'Y Si…',
    'ACTION QUALITY': 'CALIDAD DE LA ACCIÓN',
    'How good was the action? (stage and scoreline aside)': '¿Qué tan buena fue la acción? (sin contar fase ni marcador)',
    'Poor': 'Pobre', 'Reasonable': 'Razonable', 'Good': 'Buena', 'Outstanding': 'Sobresaliente',
    'Right call?': '¿Acierto?',
    'Execution': 'Ejecución', 'Struck well?': '¿Bien golpeado?',
    'Difficulty': 'Dificultad', 'How hard?': '¿Qué tan difícil?',
    'REASONING': 'ANÁLISIS',
    'Neutral situation, no strong factors': 'Situación neutral, sin factores destacados',
    'AI FIELD READ': 'LECTURA IA DEL CAMPO',
    'threat': 'amenaza', 'threats': 'amenazas',
    'open target': 'opción libre', 'open targets': 'opciones libres',
    'blocked lane': 'línea bloqueada', 'blocked lanes': 'líneas bloqueadas', 'vetoed': 'vetadas',
    'SITUATION': 'SITUACIÓN',
    'Pressure': 'Presión', 'Nearest defender': 'Defensor más cercano',
    'Open teammates': 'Compañeros libres', 'Opponents involved': 'Rivales involucrados',
    'Expected goals': 'Goles esperados', 'Outcome': 'Resultado',
    'MOMENT STAKES': 'IMPORTANCIA DEL MOMENTO', 'Context model': 'Modelo de contexto',
    'How much could this moment change the result?': '¿Cuánto podría cambiar este momento el resultado?',
    'Decisive': 'Decisivo', 'High': 'Alto', 'Medium': 'Medio', 'Low': 'Bajo',
    'DECISION DNA': 'ADN DE LA DECISIÓN',
    'The fingerprint of the action, not a rating': 'La huella de la acción, no una nota',
    'Defined by': 'Definido por',
    'DIFFICULTY': 'DIFICULTAD', 'LEVERAGE': 'INFLUENCIA', 'VISION': 'VISIÓN', 'RISK': 'RIESGO', 'EXECUTION': 'EJECUCIÓN',
    'Vision': 'Visión', 'Risk': 'Riesgo', 'Leverage': 'Influencia',
    'What were the alternatives, and was this the best call?': '¿Qué alternativas había, y fue esta la mejor decisión?',
    'Weighing every option…': 'Sopesando cada opción…',
    'Optimal choice': 'Elección óptima', 'Better option was on': 'Había una opción mejor', 'Sound choice': 'Elección acertada', 'Forced choice': 'Elección forzada',
    'chosen': 'elegida', 'best': 'mejor', 'blocked': 'bloqueada', 'est': 'est',
    'local estimate': 'estimación local',
    'Options valued by the threat (xT) of the position the ball reaches (real Karun Singh surface); the shot by estimated xG.': 'Opciones valoradas por la amenaza (xT) de la posición a la que llega el balón (superficie real de Karun Singh); el tiro por xG estimado.',
    'Decision Intelligence': 'Inteligencia de Decisiones',
    'Go beyond the highlight.': 'Ve más allá del resumen.',
    'FirstTouch recreates the tactical reality of any FIFA World Cup 2022™ moment and analyzes the decision that shaped it.': 'FirstTouch recrea la realidad táctica de cualquier momento de la Copa Mundial FIFA 2022™ y analiza la decisión que lo definió.',
    'Analyzing frame…': 'Analizando la jugada…',
    'No 360 freeze frame is available for this event. Pick a moment marked at full opacity in the event list.': 'No hay imagen 360 disponible para este evento. Elige un momento marcado con opacidad completa en la lista.',
    'Prev': 'Ant', 'Next': 'Sig',
    'IBM Granite is assessing this moment…': 'IBM Granite está evaluando este momento…',
    'Granite assessing…': 'Granite evaluando…',
    // analyst box
    "Pick a moment and I'll break down the decision.": 'Elige un momento y analizaré la decisión.',
    'Reading the moment…': 'Leyendo el momento…',
    'Powered by': 'Impulsado por',
    // outcomes
    'Goal': 'Gol', 'Complete': 'Completado', 'Incomplete': 'Incompleto', 'Saved': 'Atajado', 'Missed': 'Fallado',
    'Carry': 'Conducción', 'Goal Keeper': 'Portero', 'Clearance': 'Despeje', 'Interception': 'Intercepción', 'Block': 'Bloqueo', 'Ball Recovery': 'Recuperación', 'Foul Won': 'Falta recibida', 'Foul Committed': 'Falta cometida', 'Dispossessed': 'Desposeído', 'Miscontrol': 'Mal control', 'Duel': 'Duelo', 'Lost Duel': 'Duelo perdido', 'GOAL': 'GOL',
    'Middle Third': 'Tercio medio', 'Attacking Third': 'Tercio de ataque', 'Defensive Third': 'Tercio defensivo', 'Penalty Area': 'Área', 'Final Third': 'Último tercio',
    // stakes drivers
    'Group stage': 'Fase de grupos',
    'Knockout final': 'Eliminatoria: final', 'Knockout round of 16': 'Eliminatoria: octavos', 'Knockout quarter-final': 'Eliminatoria: cuartos', 'Knockout semi-final': 'Eliminatoria: semifinal', 'Knockout third-place play-off': 'Eliminatoria: tercer puesto',
    'Penalty shootout': 'Tanda de penaltis', 'Extra time': 'Prórroga', 'Scores level': 'Empate', 'Trailing by one': 'Pierde por uno', 'Protecting a one-goal lead': 'Defendiendo una ventaja de un gol', 'Game already decided': 'Partido ya decidido', 'Goalscoring chance': 'Ocasión de gol', 'Goal assist': 'Asistencia de gol', 'Low-danger phase': 'Fase de bajo peligro',
    // consequence chain
    'CONSEQUENCE CHAIN': 'CADENA DE CONSECUENCIAS', 'Real possession data': 'Datos reales de posesión', 'Tracing the move…': 'Trazando la jugada…',
    'SHOT SAVED': 'TIRO ATAJADO', 'SHOT BLOCKED': 'TIRO BLOQUEADO', 'SHOT OFF TARGET': 'TIRO DESVIADO', 'POSSESSION LOST': 'POSESIÓN PERDIDA', 'MOVE BROKEN UP': 'JUGADA CORTADA',
    'you are here': 'estás aquí',
    'A standalone action; the consequence was immediate.': 'Una acción aislada; la consecuencia fue inmediata.',
    '{n}-touch move': 'Jugada de {n} toques', ', {n} pass': ', {n} pase', ', {n} passes': ', {n} pases', ', finished by {name}': ', finalizada por {name}',
    'Consequence Chain': 'Cadena de consecuencias', 'Jump to this moment': 'Ir a este momento',
    'Ended in a goal, finished by {name}.': 'Terminó en gol, finalizado por {name}.',
    "Move broken up after {name}'s {how}.": 'Jugada cortada tras {how} de {name}.',
    'blocked shot': 'tiro bloqueado', 'saved shot': 'tiro atajado', 'shot off target': 'tiro desviado', 'incomplete pass': 'pase incompleto', 'lost ball': 'pérdida de balón',
    'ball won here': 'balón recuperado aquí', 'possession changes': 'cambio de posesión', 'ATTACK': 'ATAQUE',
    'Analysis': 'Análisis', 'Line-ups': 'Alineaciones',
    'Back to Analysis': 'Volver al análisis', 'Lineups and Tactics': 'Alineaciones y táctica',
    'Formations · subs · manager': 'Formaciones · cambios · entrenador',
    'Select a match to see the line-ups.': 'Selecciona un partido para ver las alineaciones.',
    'Loading the team sheets…': 'Cargando las alineaciones…', 'Reading the tactics…': 'Analizando la táctica…',
    'MANAGER': 'ENTRENADOR', 'TACTICAL READ': 'LECTURA TÁCTICA',
    'On': 'Entra', 'Off': 'Sale', 'for': 'por', 'goal': 'gol', 'goals': 'goles', 'assist': 'asistencia', 'assists': 'asistencias',
    'pass': 'pase', 'shot': 'tiro', 'dribble': 'regate', 'carry': 'conducción', 'press': 'presión', 'interception': 'intercepción', 'clearance': 'despeje', 'block': 'bloqueo', 'keeper': 'portero',
    // phase tabs
    '1st': '1.ª', '2nd': '2.ª', 'ET1': 'P1', 'ET2': 'P2', 'Pens': 'Pen', 'PENS': 'PEN',
    // extra outcomes
    'Off Target': 'Desviado', 'Saved Off Target': 'Atajado y desviado', 'Saved Onto the Post': 'Atajado al poste', 'Out': 'Fuera',
    'middle third': 'tercio medio', 'attacking third': 'tercio de ataque', 'defensive third': 'tercio defensivo', 'penalty area': 'área', 'final third': 'último tercio',
    'Full screen': 'Pantalla completa', 'Exit full screen': 'Salir de pantalla completa',
  },
  fr: {
    'Beyond Highlights, Into Insights': 'Au-delà des Résumés',
    'IBM Granite and watsonx.ai showcase': 'Vitrine IBM Granite et watsonx.ai',
    'Reset': 'Réinitialiser',
    'Match': 'Match',
    'API offline': 'API hors ligne',
    'Select a match…': 'Choisissez un match…',
    'Loading 64 matches…': 'Chargement de 64 matchs…',
    'Search team or stage…': 'Rechercher une équipe ou une phase…',
    'No matches found': 'Aucun match trouvé',
    'Group Stage': 'Phase de Groupes',
    'Round of 16': 'Huitièmes de Finale',
    'Quarter-finals': 'Quarts de Finale',
    'Semi-finals': 'Demi-finales',
    '3rd Place Final': 'Match pour la 3e Place',
    'Final': 'Finale',
    'Events': 'Événements',
    'All': 'Tous', 'Goals': 'Buts', 'Shot': 'Tir', 'Pass': 'Passe', 'Dribble': 'Dribble', 'Defence': 'Défense',
    'All players': 'Tous les joueurs',
    'Search players…': 'Rechercher des joueurs…',
    'Select a match to load its events': 'Choisissez un match pour charger ses événements',
    'Loading events & 360 frames…': 'Chargement des événements et données 360…',
    'First load of a match takes a few seconds': 'Le premier chargement prend quelques secondes',
    'Welcome to FirstTouch': 'Bienvenue sur FirstTouch',
    'SELECT MATCH': 'CHOISIR UN MATCH',
    'FIFA World Cup 2022™ · 64 matches · Full 360° freeze-frame coverage': 'Coupe du Monde FIFA 2022™ · 64 matchs · Couverture 360° complète',
    'PICK A MOMENT': 'CHOISIR UN MOMENT',
    'Choose an event from the list to reconstruct what the player saw': 'Choisissez un événement dans la liste pour reconstituer ce que le joueur a vu',
    'PRESSURE': 'PRESSION', 'OPEN': 'LIBRES', 'NEAREST DEF': 'DÉF PROCHE', 'OUTCOME': 'RÉSULTAT',
    'Open Lane': 'Couloir libre', 'Blocked': 'Bloqué',
    'Pass Made': 'Passe effectuée', 'Carry Made': 'Conduite', 'Shot Goal': 'Tir au but',
    '🖱 Drag rotate · Right-drag pan · Scroll zoom · Double-click recenter': '🖱 Glisser pour pivoter · Clic droit pour déplacer · Molette pour zoomer · Double-clic pour recentrer',
    'HIGH': 'ÉLEVÉE', 'MEDIUM': 'MOYENNE', 'LOW': 'FAIBLE',
    'MOMENTUM': 'DYNAMIQUE',
    'Decision': 'Décision', 'Profile': 'Profil', 'Chain': 'Séquence', 'What If': 'Et Si…',
    'ACTION QUALITY': "QUALITÉ DE L'ACTION",
    'How good was the action? (stage and scoreline aside)': "L'action était-elle bonne ? (hors phase et score)",
    'Poor': 'Médiocre', 'Reasonable': 'Correcte', 'Good': 'Bonne', 'Outstanding': 'Exceptionnelle',
    'Right call?': 'Bon choix ?',
    'Execution': 'Exécution', 'Struck well?': 'Bien frappé ?',
    'Difficulty': 'Difficulté', 'How hard?': 'Difficile ?',
    'REASONING': 'ANALYSE',
    'Neutral situation, no strong factors': 'Situation neutre, aucun facteur marquant',
    'AI FIELD READ': 'LECTURE IA DU TERRAIN',
    'threat': 'menace', 'threats': 'menaces',
    'open target': 'cible libre', 'open targets': 'cibles libres',
    'blocked lane': 'couloir bloqué', 'blocked lanes': 'couloirs bloqués', 'vetoed': 'rejetés',
    'SITUATION': 'SITUATION',
    'Pressure': 'Pression', 'Nearest defender': 'Défenseur le plus proche',
    'Open teammates': 'Coéquipiers libres', 'Opponents involved': 'Adversaires impliqués',
    'Expected goals': 'Buts attendus', 'Outcome': 'Résultat',
    'MOMENT STAKES': 'ENJEU DU MOMENT', 'Context model': 'Modèle de contexte',
    'How much could this moment change the result?': 'À quel point ce moment peut-il changer le résultat ?',
    'Decisive': 'Décisif', 'High': 'Élevé', 'Medium': 'Moyen', 'Low': 'Faible',
    'DECISION DNA': 'ADN DE LA DÉCISION',
    'The fingerprint of the action, not a rating': "L'empreinte de l'action, pas une note",
    'Defined by': 'Défini par',
    'DIFFICULTY': 'DIFFICULTÉ', 'LEVERAGE': 'IMPACT', 'VISION': 'VISION', 'RISK': 'RISQUE', 'EXECUTION': 'EXÉCUTION',
    'Vision': 'Vision', 'Risk': 'Risque', 'Leverage': 'Impact',
    'What were the alternatives, and was this the best call?': "Quelles étaient les alternatives, et était-ce le bon choix ?",
    'Weighing every option…': 'Évaluation de chaque option…',
    'Optimal choice': 'Choix optimal', 'Better option was on': 'Une meilleure option existait', 'Sound choice': 'Choix judicieux', 'Forced choice': 'Choix forcé',
    'chosen': 'choisie', 'best': 'meilleure', 'blocked': 'bloquée', 'est': 'est',
    'local estimate': 'estimation locale',
    'Options valued by the threat (xT) of the position the ball reaches (real Karun Singh surface); the shot by estimated xG.': 'Options évaluées selon la menace (xT) de la position atteinte par le ballon (surface réelle de Karun Singh) ; le tir par xG estimé.',
    'Decision Intelligence': 'Intelligence Décisionnelle',
    'Go beyond the highlight.': 'Allez au-delà du résumé.',
    'FirstTouch recreates the tactical reality of any FIFA World Cup 2022™ moment and analyzes the decision that shaped it.': "FirstTouch recrée la réalité tactique de tout moment de la Coupe du Monde FIFA 2022™ et analyse la décision qui l'a façonné.",
    'Analyzing frame…': 'Analyse de la séquence…',
    'No 360 freeze frame is available for this event. Pick a moment marked at full opacity in the event list.': "Aucune image 360 n'est disponible pour cet événement. Choisissez un moment affiché en pleine opacité dans la liste.",
    'Prev': 'Préc', 'Next': 'Suiv',
    'IBM Granite is assessing this moment…': 'IBM Granite évalue ce moment…',
    'Granite assessing…': 'Granite évalue…',
    "Pick a moment and I'll break down the decision.": "Choisissez un moment et j'analyserai la décision.",
    'Reading the moment…': 'Lecture du moment…',
    'Powered by': 'Propulsé par',
    'Goal': 'But', 'Complete': 'Réussie', 'Incomplete': 'Manquée', 'Saved': 'Arrêté', 'Missed': 'Manqué',
    'Carry': 'Conduite', 'Goal Keeper': 'Gardien', 'Clearance': 'Dégagement', 'Interception': 'Interception', 'Block': 'Contre', 'Ball Recovery': 'Récupération', 'Foul Won': 'Faute subie', 'Foul Committed': 'Faute commise', 'Dispossessed': 'Dépossédé', 'Miscontrol': 'Mauvais contrôle', 'Duel': 'Duel', 'Lost Duel': 'Duel perdu', 'GOAL': 'BUT',
    'Middle Third': 'Tiers médian', 'Attacking Third': 'Tiers offensif', 'Defensive Third': 'Tiers défensif', 'Penalty Area': 'Surface', 'Final Third': 'Dernier tiers',
    // stakes drivers
    'Group stage': 'Phase de groupes',
    'Knockout final': 'Élimination directe : finale', 'Knockout round of 16': 'Élimination directe : huitièmes', 'Knockout quarter-final': 'Élimination directe : quarts', 'Knockout semi-final': 'Élimination directe : demi-finale', 'Knockout third-place play-off': 'Élimination directe : 3e place',
    'Penalty shootout': 'Séance de tirs au but', 'Extra time': 'Prolongation', 'Scores level': 'Score à égalité', 'Trailing by one': "Mené d'un but", 'Protecting a one-goal lead': "Protège une avance d'un but", 'Game already decided': 'Match déjà joué', 'Goalscoring chance': 'Occasion de but', 'Goal assist': 'Passe décisive', 'Low-danger phase': 'Phase peu dangereuse',
    // consequence chain
    'CONSEQUENCE CHAIN': 'CHAÎNE DE CONSÉQUENCES', 'Real possession data': 'Données réelles de possession', 'Tracing the move…': "Reconstitution de l'action…",
    'SHOT SAVED': 'TIR ARRÊTÉ', 'SHOT BLOCKED': 'TIR CONTRÉ', 'SHOT OFF TARGET': 'TIR NON CADRÉ', 'POSSESSION LOST': 'BALLON PERDU', 'MOVE BROKEN UP': 'ACTION STOPPÉE',
    'you are here': 'vous êtes ici',
    'A standalone action; the consequence was immediate.': 'Une action isolée ; la conséquence a été immédiate.',
    '{n}-touch move': 'Action en {n} touches', ', {n} pass': ', {n} passe', ', {n} passes': ', {n} passes', ', finished by {name}': ', conclue par {name}',
    'Consequence Chain': 'Chaîne de conséquences', 'Jump to this moment': 'Aller à ce moment',
    'Ended in a goal, finished by {name}.': 'Conclue par un but, marqué par {name}.',
    "Move broken up after {name}'s {how}.": 'Action stoppée après {how} de {name}.',
    'blocked shot': 'tir contré', 'saved shot': 'tir arrêté', 'shot off target': 'tir non cadré', 'incomplete pass': 'passe manquée', 'lost ball': 'ballon perdu',
    'ball won here': 'ballon récupéré ici', 'possession changes': 'changement de possession', 'ATTACK': 'ATTAQUE',
    'Analysis': 'Analyse', 'Line-ups': 'Compositions',
    'Back to Analysis': "Retour à l'analyse", 'Lineups and Tactics': 'Compositions et tactique',
    'Formations · subs · manager': 'Formations · remplacements · entraîneur',
    'Select a match to see the line-ups.': 'Sélectionnez un match pour voir les compositions.',
    'Loading the team sheets…': 'Chargement des compositions…', 'Reading the tactics…': 'Analyse de la tactique…',
    'MANAGER': 'ENTRAÎNEUR', 'TACTICAL READ': 'LECTURE TACTIQUE',
    'On': 'Entre', 'Off': 'Sort', 'for': 'pour', 'goal': 'but', 'goals': 'buts', 'assist': 'passe d.', 'assists': 'passes d.',
    'pass': 'passe', 'shot': 'tir', 'dribble': 'dribble', 'carry': 'conduite', 'press': 'pressing', 'interception': 'interception', 'clearance': 'dégagement', 'block': 'contre', 'keeper': 'gardien',
    // phase tabs
    '1st': '1re', '2nd': '2e', 'ET1': 'P1', 'ET2': 'P2', 'Pens': 'TAB', 'PENS': 'TAB',
    // extra outcomes
    'Off Target': 'Non cadré', 'Saved Off Target': 'Arrêté hors cadre', 'Saved Onto the Post': 'Arrêté sur le poteau', 'Out': 'Sortie',
    'middle third': 'tiers médian', 'attacking third': 'tiers offensif', 'defensive third': 'tiers défensif', 'penalty area': 'surface', 'final third': 'dernier tiers',
    'Full screen': 'Plein écran', 'Exit full screen': 'Quitter le plein écran',
  },
  de: {
    'Beyond Highlights, Into Insights': 'Mehr als Highlights',
    'IBM Granite and watsonx.ai showcase': 'IBM Granite und watsonx.ai Schaufenster',
    'Reset': 'Zurücksetzen',
    'Match': 'Spiel',
    'API offline': 'API offline',
    'Select a match…': 'Spiel auswählen…',
    'Loading 64 matches…': '64 Spiele werden geladen…',
    'Search team or stage…': 'Team oder Phase suchen…',
    'No matches found': 'Keine Spiele gefunden',
    'Group Stage': 'Gruppenphase',
    'Round of 16': 'Achtelfinale',
    'Quarter-finals': 'Viertelfinale',
    'Semi-finals': 'Halbfinale',
    '3rd Place Final': 'Spiel um Platz 3',
    'Final': 'Finale',
    'Events': 'Ereignisse',
    'All': 'Alle', 'Goals': 'Tore', 'Shot': 'Schuss', 'Pass': 'Pass', 'Dribble': 'Dribbling', 'Defence': 'Abwehr',
    'All players': 'Alle Spieler',
    'Search players…': 'Spieler suchen…',
    'Select a match to load its events': 'Wähle ein Spiel, um seine Ereignisse zu laden',
    'Loading events & 360 frames…': 'Ereignisse und 360-Daten werden geladen…',
    'First load of a match takes a few seconds': 'Das erste Laden dauert einige Sekunden',
    'Welcome to FirstTouch': 'Willkommen bei FirstTouch',
    'SELECT MATCH': 'SPIEL WÄHLEN',
    'FIFA World Cup 2022™ · 64 matches · Full 360° freeze-frame coverage': 'FIFA Weltmeisterschaft 2022™ · 64 Spiele · Vollständige 360°-Abdeckung',
    'PICK A MOMENT': 'MOMENT WÄHLEN',
    'Choose an event from the list to reconstruct what the player saw': 'Wähle ein Ereignis aus der Liste, um zu rekonstruieren, was der Spieler sah',
    'PRESSURE': 'DRUCK', 'OPEN': 'FREI', 'NEAREST DEF': 'NÄCHSTER VERT', 'OUTCOME': 'ERGEBNIS',
    'Open Lane': 'Freie Linie', 'Blocked': 'Blockiert',
    'Pass Made': 'Pass gespielt', 'Carry Made': 'Ballführung', 'Shot Goal': 'Torschuss',
    '🖱 Drag rotate · Right-drag pan · Scroll zoom · Double-click recenter': '🖱 Ziehen zum Drehen · Rechtsklick zum Verschieben · Scrollen zum Zoomen · Doppelklick zum Zentrieren',
    'HIGH': 'HOCH', 'MEDIUM': 'MITTEL', 'LOW': 'NIEDRIG',
    'MOMENTUM': 'MOMENTUM',
    'Decision': 'Entscheidung', 'Profile': 'Profil', 'Chain': 'Kette', 'What If': 'Was wäre wenn',
    'ACTION QUALITY': 'AKTIONSQUALITÄT',
    'How good was the action? (stage and scoreline aside)': 'Wie gut war die Aktion? (unabhängig von Phase und Spielstand)',
    'Poor': 'Schwach', 'Reasonable': 'Vernünftig', 'Good': 'Gut', 'Outstanding': 'Herausragend',
    'Right call?': 'Richtig?',
    'Execution': 'Ausführung', 'Struck well?': 'Gut getroffen?',
    'Difficulty': 'Schwierigkeit', 'How hard?': 'Wie schwer?',
    'REASONING': 'BEGRÜNDUNG',
    'Neutral situation, no strong factors': 'Neutrale Situation, keine starken Faktoren',
    'AI FIELD READ': 'KI-SPIELFELDANALYSE',
    'threat': 'Gefahr', 'threats': 'Gefahren',
    'open target': 'freie Option', 'open targets': 'freie Optionen',
    'blocked lane': 'blockierte Linie', 'blocked lanes': 'blockierte Linien', 'vetoed': 'verworfen',
    'SITUATION': 'SITUATION',
    'Pressure': 'Druck', 'Nearest defender': 'Nächster Verteidiger',
    'Open teammates': 'Freie Mitspieler', 'Opponents involved': 'Beteiligte Gegner',
    'Expected goals': 'Erwartete Tore', 'Outcome': 'Ergebnis',
    'MOMENT STAKES': 'BEDEUTUNG DES MOMENTS', 'Context model': 'Kontextmodell',
    'How much could this moment change the result?': 'Wie sehr könnte dieser Moment das Ergebnis verändern?',
    'Decisive': 'Entscheidend', 'High': 'Hoch', 'Medium': 'Mittel', 'Low': 'Gering',
    'DECISION DNA': 'ENTSCHEIDUNGS-DNA',
    'The fingerprint of the action, not a rating': 'Der Fingerabdruck der Aktion, keine Bewertung',
    'Defined by': 'Geprägt von',
    'DIFFICULTY': 'SCHWIERIGKEIT', 'LEVERAGE': 'HEBELWIRKUNG', 'VISION': 'VISION', 'RISK': 'RISIKO', 'EXECUTION': 'AUSFÜHRUNG',
    'Vision': 'Vision', 'Risk': 'Risiko', 'Leverage': 'Hebelwirkung',
    'What were the alternatives, and was this the best call?': 'Welche Alternativen gab es, und war das die beste Wahl?',
    'Weighing every option…': 'Jede Option wird abgewogen…',
    'Optimal choice': 'Optimale Wahl', 'Better option was on': 'Bessere Option war da', 'Sound choice': 'Solide Wahl', 'Forced choice': 'Erzwungene Wahl',
    'chosen': 'gewählt', 'best': 'beste', 'blocked': 'blockiert', 'est': 'gesch.',
    'local estimate': 'lokale Schätzung',
    'Options valued by the threat (xT) of the position the ball reaches (real Karun Singh surface); the shot by estimated xG.': 'Optionen bewertet nach der Bedrohung (xT) der Position, die der Ball erreicht (echte Karun-Singh-Fläche); der Schuss nach geschätztem xG.',
    'Decision Intelligence': 'Entscheidungsintelligenz',
    'Go beyond the highlight.': 'Mehr als nur das Highlight.',
    'FirstTouch recreates the tactical reality of any FIFA World Cup 2022™ moment and analyzes the decision that shaped it.': 'FirstTouch rekonstruiert die taktische Realität jedes Moments der FIFA Weltmeisterschaft 2022™ und analysiert die Entscheidung, die ihn prägte.',
    'Analyzing frame…': 'Szene wird analysiert…',
    'No 360 freeze frame is available for this event. Pick a moment marked at full opacity in the event list.': 'Für dieses Ereignis ist kein 360-Standbild verfügbar. Wähle einen Moment, der in der Liste voll sichtbar ist.',
    'Prev': 'Zurück', 'Next': 'Weiter',
    'IBM Granite is assessing this moment…': 'IBM Granite bewertet diesen Moment…',
    'Granite assessing…': 'Granite bewertet…',
    "Pick a moment and I'll break down the decision.": 'Wähle einen Moment und ich analysiere die Entscheidung.',
    'Reading the moment…': 'Moment wird gelesen…',
    'Powered by': 'Angetrieben von',
    'Goal': 'Tor', 'Complete': 'Erfolgreich', 'Incomplete': 'Fehlpass', 'Saved': 'Gehalten', 'Missed': 'Verfehlt',
    'Carry': 'Ballführung', 'Goal Keeper': 'Torwart', 'Clearance': 'Klärung', 'Interception': 'Abfangen', 'Block': 'Block', 'Ball Recovery': 'Balleroberung', 'Foul Won': 'Foul erhalten', 'Foul Committed': 'Foul begangen', 'Dispossessed': 'Ball verloren', 'Miscontrol': 'Ballverlust', 'Duel': 'Zweikampf', 'Lost Duel': 'Duell verloren', 'GOAL': 'TOR',
    'Middle Third': 'Mittleres Drittel', 'Attacking Third': 'Angriffsdrittel', 'Defensive Third': 'Abwehrdrittel', 'Penalty Area': 'Strafraum', 'Final Third': 'Letztes Drittel',
    // stakes drivers
    'Group stage': 'Gruppenphase',
    'Knockout final': 'K.-o.-Runde: Finale', 'Knockout round of 16': 'K.-o.-Runde: Achtelfinale', 'Knockout quarter-final': 'K.-o.-Runde: Viertelfinale', 'Knockout semi-final': 'K.-o.-Runde: Halbfinale', 'Knockout third-place play-off': 'K.-o.-Runde: Spiel um Platz 3',
    'Penalty shootout': 'Elfmeterschießen', 'Extra time': 'Verlängerung', 'Scores level': 'Unentschieden', 'Trailing by one': 'Ein Tor zurück', 'Protecting a one-goal lead': 'Führung von einem Tor verteidigen', 'Game already decided': 'Spiel bereits entschieden', 'Goalscoring chance': 'Torchance', 'Goal assist': 'Torvorlage', 'Low-danger phase': 'Phase ohne Gefahr',
    // consequence chain
    'CONSEQUENCE CHAIN': 'KONSEQUENZKETTE', 'Real possession data': 'Echte Ballbesitzdaten', 'Tracing the move…': 'Aktion wird verfolgt…',
    'SHOT SAVED': 'SCHUSS GEHALTEN', 'SHOT BLOCKED': 'SCHUSS GEBLOCKT', 'SHOT OFF TARGET': 'SCHUSS DANEBEN', 'POSSESSION LOST': 'BALL VERLOREN', 'MOVE BROKEN UP': 'AKTION UNTERBROCHEN',
    'you are here': 'du bist hier',
    'A standalone action; the consequence was immediate.': 'Eine einzelne Aktion; die Folge war unmittelbar.',
    '{n}-touch move': 'Aktion mit {n} Ballkontakten', ', {n} pass': ', {n} Pass', ', {n} passes': ', {n} Pässe', ', finished by {name}': ', abgeschlossen von {name}',
    'Consequence Chain': 'Konsequenzkette', 'Jump to this moment': 'Zu diesem Moment springen',
    'Ended in a goal, finished by {name}.': 'Endete mit einem Tor, erzielt von {name}.',
    "Move broken up after {name}'s {how}.": 'Aktion unterbrochen nach {how} von {name}.',
    'blocked shot': 'geblockter Schuss', 'saved shot': 'gehaltener Schuss', 'shot off target': 'Schuss daneben', 'incomplete pass': 'Fehlpass', 'lost ball': 'Ballverlust',
    'ball won here': 'Ball hier erobert', 'possession changes': 'Ballbesitzwechsel', 'ATTACK': 'ANGRIFF',
    'Analysis': 'Analyse', 'Line-ups': 'Aufstellungen',
    'Back to Analysis': 'Zurück zur Analyse', 'Lineups and Tactics': 'Aufstellungen und Taktik',
    'Formations · subs · manager': 'Aufstellungen · Wechsel · Trainer',
    'Select a match to see the line-ups.': 'Wähle ein Spiel, um die Aufstellungen zu sehen.',
    'Loading the team sheets…': 'Aufstellungen werden geladen…', 'Reading the tactics…': 'Taktik wird analysiert…',
    'MANAGER': 'TRAINER', 'TACTICAL READ': 'TAKTISCHE ANALYSE',
    'On': 'Ein', 'Off': 'Aus', 'for': 'für', 'goal': 'Tor', 'goals': 'Tore', 'assist': 'Vorlage', 'assists': 'Vorlagen',
    'pass': 'Pass', 'shot': 'Schuss', 'dribble': 'Dribbling', 'carry': 'Ballführung', 'press': 'Pressing', 'interception': 'Abfangen', 'clearance': 'Klärung', 'block': 'Block', 'keeper': 'Torwart',
    // phase tabs
    '1st': '1.', '2nd': '2.', 'ET1': 'V1', 'ET2': 'V2', 'Pens': 'Elfm.', 'PENS': 'ELFM.',
    // extra outcomes
    'Off Target': 'Daneben', 'Saved Off Target': 'Gehalten, daneben', 'Saved Onto the Post': 'An den Pfosten gehalten', 'Out': 'Aus',
    'middle third': 'mittleres Drittel', 'attacking third': 'Angriffsdrittel', 'defensive third': 'Abwehrdrittel', 'penalty area': 'Strafraum', 'final third': 'letztes Drittel',
    'Full screen': 'Vollbild', 'Exit full screen': 'Vollbild beenden',
  },
}

// WC2022 national team names per language (incl. common StatsBomb variants).
// Keep flag lookups on the original English name; only the DISPLAY is localized.
const COUNTRIES = {
  es: {
    'Qatar': 'Catar', 'Ecuador': 'Ecuador', 'Senegal': 'Senegal', 'Netherlands': 'Países Bajos',
    'England': 'Inglaterra', 'Iran': 'Irán', 'IR Iran': 'Irán', 'United States': 'Estados Unidos',
    'Wales': 'Gales', 'Argentina': 'Argentina', 'Saudi Arabia': 'Arabia Saudí', 'Mexico': 'México',
    'Poland': 'Polonia', 'France': 'Francia', 'Australia': 'Australia', 'Denmark': 'Dinamarca',
    'Tunisia': 'Túnez', 'Spain': 'España', 'Costa Rica': 'Costa Rica', 'Germany': 'Alemania',
    'Japan': 'Japón', 'Belgium': 'Bélgica', 'Canada': 'Canadá', 'Morocco': 'Marruecos',
    'Croatia': 'Croacia', 'Brazil': 'Brasil', 'Serbia': 'Serbia', 'Switzerland': 'Suiza',
    'Cameroon': 'Camerún', 'Portugal': 'Portugal', 'Ghana': 'Ghana', 'Uruguay': 'Uruguay',
    'South Korea': 'Corea del Sur', 'Korea Republic': 'Corea del Sur',
  },
  fr: {
    'Qatar': 'Qatar', 'Ecuador': 'Équateur', 'Senegal': 'Sénégal', 'Netherlands': 'Pays-Bas',
    'England': 'Angleterre', 'Iran': 'Iran', 'IR Iran': 'Iran', 'United States': 'États-Unis',
    'Wales': 'Pays de Galles', 'Argentina': 'Argentine', 'Saudi Arabia': 'Arabie saoudite', 'Mexico': 'Mexique',
    'Poland': 'Pologne', 'France': 'France', 'Australia': 'Australie', 'Denmark': 'Danemark',
    'Tunisia': 'Tunisie', 'Spain': 'Espagne', 'Costa Rica': 'Costa Rica', 'Germany': 'Allemagne',
    'Japan': 'Japon', 'Belgium': 'Belgique', 'Canada': 'Canada', 'Morocco': 'Maroc',
    'Croatia': 'Croatie', 'Brazil': 'Brésil', 'Serbia': 'Serbie', 'Switzerland': 'Suisse',
    'Cameroon': 'Cameroun', 'Portugal': 'Portugal', 'Ghana': 'Ghana', 'Uruguay': 'Uruguay',
    'South Korea': 'Corée du Sud', 'Korea Republic': 'Corée du Sud',
  },
  de: {
    'Qatar': 'Katar', 'Ecuador': 'Ecuador', 'Senegal': 'Senegal', 'Netherlands': 'Niederlande',
    'England': 'England', 'Iran': 'Iran', 'IR Iran': 'Iran', 'United States': 'USA',
    'Wales': 'Wales', 'Argentina': 'Argentinien', 'Saudi Arabia': 'Saudi-Arabien', 'Mexico': 'Mexiko',
    'Poland': 'Polen', 'France': 'Frankreich', 'Australia': 'Australien', 'Denmark': 'Dänemark',
    'Tunisia': 'Tunesien', 'Spain': 'Spanien', 'Costa Rica': 'Costa Rica', 'Germany': 'Deutschland',
    'Japan': 'Japan', 'Belgium': 'Belgien', 'Canada': 'Kanada', 'Morocco': 'Marokko',
    'Croatia': 'Kroatien', 'Brazil': 'Brasilien', 'Serbia': 'Serbien', 'Switzerland': 'Schweiz',
    'Cameroon': 'Kamerun', 'Portugal': 'Portugal', 'Ghana': 'Ghana', 'Uruguay': 'Uruguay',
    'South Korea': 'Südkorea', 'Korea Republic': 'Südkorea',
  },
}

export function translate(lang, s) {
  if (!s || lang === 'en') return s
  const d = DICT[lang]
  if (d && d[s] != null) return d[s]
  const c = COUNTRIES[lang]
  return (c && c[s]) || s
}

// The raw data names the knockout rounds with a lowercase "finals"
// ("Quarter-finals", "Semi-finals"); display them with a capital F. No-op for
// other words and for the translated labels (which don't contain "finals").
export function prettyStage(label) {
  return (label || '').replace(/finals/g, 'Finals')
}

// Stakes drivers include a couple of strings with interpolated numbers
// ("Late on (45')", "Trailing by 2") that can't be a static dictionary key.
// Match those patterns first, then fall back to the normal dictionary.
export function translateDriver(lang, d) {
  if (!d || lang === 'en') return d
  let m = d.match(/^Late on \((\d+)'\)$/)
  if (m) return ({ es: `Tramo final (${m[1]}')`, fr: `Fin de match (${m[1]}')`, de: `Schlussphase (${m[1]}')` })[lang] || d
  m = d.match(/^Trailing by (\d+)$/)
  if (m) return ({ es: `Pierde por ${m[1]}`, fr: `Mené de ${m[1]}`, de: `${m[1]} Tore zurück` })[lang] || d
  return translate(lang, d)
}

// --- Reasoning pros/cons (decisionScore.js). Local-engine fallbacks are English;
// translate them so the panel never mixes languages. Many embed numbers, so we
// match the template first, then a static table.
const REASONS = {
  es: {
    'Penalty converted under maximum pressure': 'Penalti convertido bajo máxima presión',
    'Penalty saved by the keeper': 'Penalti atajado por el portero',
    'Penalty hit the woodwork, no goal': 'El penalti dio en el palo, sin gol',
    'Penalty missed the target': 'El penalti no fue a puerta',
    'Goal, the chosen action came off': 'Gol, la acción elegida salió bien',
    'A technically difficult finish': 'Una definición técnicamente difícil',
    'Hit the target and forced the save': 'A puerta, obligó a la atajada',
    'Shot charged down before it could test the keeper': 'Tiro bloqueado antes de inquietar al portero',
    'Shot missed the target': 'El tiro no fue a puerta',
    'A pass looked the better option': 'Un pase parecía la mejor opción',
    'Assist, directly created a goal': 'Asistencia, creó un gol directamente',
    'Key pass, created a shot': 'Pase clave, generó un tiro',
    'Threaded a through ball': 'Filtró un pase entre líneas',
    'Found a team-mate, kept the move alive': 'Encontró a un compañero, mantuvo la jugada',
    'Pass did not find its man': 'El pase no encontró a su destinatario',
    'Beat his man one-v-one': 'Superó a su marcador en el uno contra uno',
    'Dribble lost, possession surrendered': 'Regate perdido, posesión entregada',
    'Kept possession ticking': 'Mantuvo la posesión',
    'Read the play and won the ball': 'Leyó la jugada y recuperó el balón',
    'Stepped in but lost the duel': 'Salió al cruce pero perdió el duelo',
    'Forced the opponent into a rushed decision': 'Forzó al rival a decidir con prisa',
    'Defensive intervention completed': 'Intervención defensiva completada',
    'Sent off, a catastrophic decision': 'Expulsado, una decisión catastrófica',
    'Second yellow, down to ten men': 'Segunda amarilla, con diez jugadores',
    'Gave away a foul and got booked': 'Cometió una falta y vio la amarilla',
    'Conceded a needless foul': 'Cometió una falta innecesaria',
  },
  fr: {
    'Penalty converted under maximum pressure': 'Penalty converti sous pression maximale',
    'Penalty saved by the keeper': 'Penalty arrêté par le gardien',
    'Penalty hit the woodwork, no goal': 'Le penalty a heurté le poteau, pas de but',
    'Penalty missed the target': 'Le penalty a manqué le cadre',
    'Goal, the chosen action came off': "But, l'action choisie a réussi",
    'A technically difficult finish': 'Une finition techniquement difficile',
    'Hit the target and forced the save': "Cadré, a forcé l'arrêt",
    'Shot charged down before it could test the keeper': "Tir contré avant d'inquiéter le gardien",
    'Shot missed the target': 'Le tir a manqué le cadre',
    'A pass looked the better option': 'Une passe semblait préférable',
    'Assist, directly created a goal': 'Passe décisive, a directement créé un but',
    'Key pass, created a shot': 'Passe clé, a créé un tir',
    'Threaded a through ball': 'A glissé une passe en profondeur',
    'Found a team-mate, kept the move alive': "A trouvé un coéquipier, a maintenu l'action",
    'Pass did not find its man': "La passe n'a pas trouvé son destinataire",
    'Beat his man one-v-one': 'A éliminé son adversaire en un-contre-un',
    'Dribble lost, possession surrendered': 'Dribble perdu, possession cédée',
    'Kept possession ticking': 'A conservé la possession',
    'Read the play and won the ball': 'A lu le jeu et récupéré le ballon',
    'Stepped in but lost the duel': 'Est intervenu mais a perdu le duel',
    'Forced the opponent into a rushed decision': "A forcé l'adversaire à décider dans la précipitation",
    'Defensive intervention completed': 'Intervention défensive réussie',
    'Sent off, a catastrophic decision': 'Expulsé, une décision catastrophique',
    'Second yellow, down to ten men': 'Deuxième jaune, réduit à dix',
    'Gave away a foul and got booked': "A concédé une faute et écopé d'un carton",
    'Conceded a needless foul': 'A concédé une faute inutile',
  },
  de: {
    'Penalty converted under maximum pressure': 'Elfmeter unter höchstem Druck verwandelt',
    'Penalty saved by the keeper': 'Elfmeter vom Torwart gehalten',
    'Penalty hit the woodwork, no goal': 'Elfmeter an den Pfosten, kein Tor',
    'Penalty missed the target': 'Elfmeter verfehlte das Tor',
    'Goal, the chosen action came off': 'Tor, die gewählte Aktion ging auf',
    'A technically difficult finish': 'Ein technisch schwieriger Abschluss',
    'Hit the target and forced the save': 'Aufs Tor gebracht und die Parade erzwungen',
    'Shot charged down before it could test the keeper': 'Schuss geblockt, bevor er den Torwart prüfen konnte',
    'Shot missed the target': 'Schuss verfehlte das Tor',
    'A pass looked the better option': 'Ein Pass wäre die bessere Option gewesen',
    'Assist, directly created a goal': 'Vorlage, direkt ein Tor aufgelegt',
    'Key pass, created a shot': 'Schlüsselpass, einen Schuss eingeleitet',
    'Threaded a through ball': 'Einen Steckpass gespielt',
    'Found a team-mate, kept the move alive': 'Fand einen Mitspieler, hielt die Aktion am Leben',
    'Pass did not find its man': 'Der Pass fand seinen Mann nicht',
    'Beat his man one-v-one': 'Setzte sich im Eins-gegen-eins durch',
    'Dribble lost, possession surrendered': 'Dribbling verloren, Ballbesitz abgegeben',
    'Kept possession ticking': 'Hielt den Ball in den eigenen Reihen',
    'Read the play and won the ball': 'Las das Spiel und eroberte den Ball',
    'Stepped in but lost the duel': 'Ging dazwischen, verlor aber das Duell',
    'Forced the opponent into a rushed decision': 'Zwang den Gegner zu einer überhasteten Entscheidung',
    'Defensive intervention completed': 'Defensive Aktion abgeschlossen',
    'Sent off, a catastrophic decision': 'Platzverweis, eine katastrophale Entscheidung',
    'Second yellow, down to ten men': 'Gelb-Rot, nur noch zu zehnt',
    'Gave away a foul and got booked': 'Beging ein Foul und sah Gelb',
    'Conceded a needless foul': 'Beging ein unnötiges Foul',
  },
}

export function translateReason(lang, s) {
  if (!s || lang === 'en') return s
  let m
  if ((m = s.match(/^Finished a low-percentage chance \(xG (.+)\)$/)))
    return ({ es: `Definió una ocasión de baja probabilidad (xG ${m[1]})`, fr: `A converti une occasion peu probable (xG ${m[1]})`, de: `Eine Chance mit geringer Wahrscheinlichkeit verwandelt (xG ${m[1]})` })[lang] || s
  if ((m = s.match(/^Took a clear chance \(xG (.+)\)$/)))
    return ({ es: `Aprovechó una ocasión clara (xG ${m[1]})`, fr: `A saisi une occasion nette (xG ${m[1]})`, de: `Eine klare Chance genutzt (xG ${m[1]})` })[lang] || s
  if ((m = s.match(/^A strong chance the keeper denied \(xG (.+)\)$/)))
    return ({ es: `Una buena ocasión que el portero atajó (xG ${m[1]})`, fr: `Une belle occasion repoussée par le gardien (xG ${m[1]})`, de: `Eine gute Chance, die der Torwart vereitelte (xG ${m[1]})` })[lang] || s
  if ((m = s.match(/^Missed the target from a clear chance \(xG (.+)\)$/)))
    return ({ es: `Falló a puerta una ocasión clara (xG ${m[1]})`, fr: `A manqué le cadre sur une occasion nette (xG ${m[1]})`, de: `Verfehlte das Tor bei klarer Chance (xG ${m[1]})` })[lang] || s
  if ((m = s.match(/^Took (\d+) defenders out with one ball$/)))
    return ({ es: `Eliminó a ${m[1]} defensores con un solo pase`, fr: `A éliminé ${m[1]} défenseurs d'une seule passe`, de: `Schaltete ${m[1]} Verteidiger mit einem Pass aus` })[lang] || s
  if ((m = s.match(/^Gained (\d+)m up the pitch$/)))
    return ({ es: `Ganó ${m[1]} m de terreno`, fr: `A gagné ${m[1]} m de terrain`, de: `Machte ${m[1]} m Raumgewinn` })[lang] || s
  if ((m = s.match(/^Drove (\d+)m up the pitch$/)))
    return ({ es: `Avanzó ${m[1]} m con el balón`, fr: `A progressé de ${m[1]} m balle au pied`, de: `Trieb den Ball ${m[1]} m nach vorne` })[lang] || s
  if ((m = s.match(/^Carried past (\d+) (?:defender|defenders)$/))) {
    const n = +m[1]
    return ({ es: `Superó a ${n} ${n === 1 ? 'defensor' : 'defensores'}`, fr: `A dépassé ${n} ${n === 1 ? 'défenseur' : 'défenseurs'}`, de: `Umspielte ${n} Verteidiger` })[lang] || s
  }
  const r = REASONS[lang]
  return (r && r[s]) || s
}

// --- What-If option labels (whatif.py). Player names stay; verbs are localized.
const WHATIF_LABELS = {
  es: { 'Shoot': 'Disparar', 'The pass played': 'El pase realizado', 'The carry made': 'La conducción realizada', 'The dribble taken': 'El regate intentado', 'The action taken': 'La acción realizada', 'team-mate': 'compañero' },
  fr: { 'Shoot': 'Tirer', 'The pass played': 'La passe jouée', 'The carry made': 'La conduite effectuée', 'The dribble taken': 'Le dribble tenté', 'The action taken': "L'action choisie", 'team-mate': 'coéquipier' },
  de: { 'Shoot': 'Schießen', 'The pass played': 'Der gespielte Pass', 'The carry made': 'Die ausgeführte Ballführung', 'The dribble taken': 'Das versuchte Dribbling', 'The action taken': 'Die gewählte Aktion', 'team-mate': 'Mitspieler' },
}

export function translateWhatifLabel(lang, s) {
  if (!s || lang === 'en') return s
  let m
  if ((m = s.match(/^Pass to (.+)$/))) {
    const who = WHATIF_LABELS[lang]?.[m[1]] || m[1]
    return ({ es: `Pase a ${who}`, fr: `Passe vers ${who}`, de: `Pass zu ${who}` })[lang] || s
  }
  if ((m = s.match(/^Carry into (\d+) m of space$/)))
    return ({ es: `Conducción a ${m[1]} m de espacio`, fr: `Conduite dans ${m[1]} m d'espace`, de: `Ballführung in ${m[1]} m Raum` })[lang] || s
  const w = WHATIF_LABELS[lang]
  return (w && w[s]) || s
}

// --- DNA axis detail (footballMetrics.js describeDNA + the stakes summary on the
// leverage axis). Numbers/pressure words are interpolated, so match templates.
const PRESSURE = { es: { low: 'baja', medium: 'media', high: 'alta' }, fr: { low: 'faible', medium: 'moyenne', high: 'élevée' }, de: { low: 'geringer', medium: 'mittlerer', high: 'hoher' } }
const DETAILS = {
  es: { 'split the line with a through ball': 'partió la línea con un pase entre líneas', 'a shot, little perception required': 'un tiro, poca lectura necesaria', 'through ball into the gaps': 'pase entre líneas a los huecos', 'a shot, low turnover risk': 'un tiro, bajo riesgo de pérdida', 'low-risk retention': 'retención de bajo riesgo', 'situational weight': 'peso del contexto', 'no clear outcome': 'sin resultado claro' },
  fr: { 'split the line with a through ball': "a cassé la ligne d'une passe en profondeur", 'a shot, little perception required': 'un tir, peu de lecture requise', 'through ball into the gaps': 'passe en profondeur dans les espaces', 'a shot, low turnover risk': 'un tir, faible risque de perte', 'low-risk retention': 'conservation à faible risque', 'situational weight': 'poids du contexte', 'no clear outcome': 'pas de résultat clair' },
  de: { 'split the line with a through ball': 'durchbrach die Linie mit einem Steckpass', 'a shot, little perception required': 'ein Schuss, wenig Übersicht nötig', 'through ball into the gaps': 'Steckpass in die Lücken', 'a shot, low turnover risk': 'ein Schuss, geringes Verlustrisiko', 'low-risk retention': 'risikoarmes Halten', 'situational weight': 'situative Bedeutung', 'no clear outcome': 'kein klares Ergebnis' },
}

export function translateDetail(lang, s) {
  if (!s || lang === 'en') return s
  // the leverage axis detail is the stakes-driver summary joined by ' · '
  if (s.includes(' · ')) return s.split(' · ').map((p) => translateDriver(lang, p)).join(' · ')
  let m
  if ((m = s.match(/^([\d.]+) xG chance, (low|medium|high) pressure$/)))
    return ({ es: `ocasión de ${m[1]} xG, presión ${PRESSURE.es[m[2]]}`, fr: `occasion de ${m[1]} xG, pression ${PRESSURE.fr[m[2]]}`, de: `${m[1]}-xG-Chance, ${PRESSURE.de[m[2]]} Druck` })[lang] || s
  if ((m = s.match(/^(low|medium|high) pressure, nearest (.+), (\d+)\/(\d+) lanes$/)))
    return ({ es: `presión ${PRESSURE.es[m[1]]}, más cercano ${m[2]}, ${m[3]}/${m[4]} líneas`, fr: `pression ${PRESSURE.fr[m[1]]}, plus proche ${m[2]}, ${m[3]}/${m[4]} couloirs`, de: `${PRESSURE.de[m[1]]} Druck, nächster ${m[2]}, ${m[3]}/${m[4]} Linien` })[lang] || s
  if ((m = s.match(/^(\d+)\/(\d+) open, found the assist$/)))
    return ({ es: `${m[1]}/${m[2]} libres, encontró la asistencia`, fr: `${m[1]}/${m[2]} démarqués, a trouvé la passe décisive`, de: `${m[1]}/${m[2]} frei, fand die Vorlage` })[lang] || s
  if ((m = s.match(/^(\d+)\/(\d+) open, found the shot$/)))
    return ({ es: `${m[1]}/${m[2]} libres, encontró el tiro`, fr: `${m[1]}/${m[2]} démarqués, a trouvé le tir`, de: `${m[1]}/${m[2]} frei, fand den Schuss` })[lang] || s
  if ((m = s.match(/^(\d+) of (\d+) team-mates in clear lanes$/)))
    return ({ es: `${m[1]} de ${m[2]} compañeros en líneas libres`, fr: `${m[1]} sur ${m[2]} coéquipiers dans des couloirs libres`, de: `${m[1]} von ${m[2]} Mitspielern in freien Linien` })[lang] || s
  if ((m = s.match(/^played through (\d+) defenders$/)))
    return ({ es: `jugó entre ${m[1]} defensores`, fr: `a traversé ${m[1]} défenseurs`, de: `spielte durch ${m[1]} Verteidiger` })[lang] || s
  if ((m = s.match(/^(\d+)m forward ball$/)))
    return ({ es: `balón de ${m[1]} m hacia adelante`, fr: `ballon de ${m[1]} m vers l'avant`, de: `${m[1]} m langer Ball nach vorne` })[lang] || s
  if ((m = s.match(/^take-on under (low|medium|high) pressure$/)))
    return ({ es: `encaró bajo presión ${PRESSURE.es[m[1]]}`, fr: `a pris son vis-à-vis sous pression ${PRESSURE.fr[m[1]]}`, de: `Eins-gegen-eins, ${PRESSURE.de[m[1]]} Druck` })[lang] || s
  const D = DETAILS[lang]
  if (D && D[s]) return D[s]
  // execution = a lowercase outcome word; route through the main dictionary
  const cap = s.charAt(0).toUpperCase() + s.slice(1)
  const t = translate(lang, cap)
  return t !== cap ? t.toLowerCase() : s
}

// localize a team/country name for display (flag lookups must use the original)
export function tCountry(lang, name) {
  const c = COUNTRIES[lang]
  return (c && c[name]) || name
}

// hook: returns a t(englishString) -> localized string function
export function useT() {
  const lang = useContext(LangContext)
  return (s) => translate(lang, s)
}

export function useLang() {
  return useContext(LangContext)
}
