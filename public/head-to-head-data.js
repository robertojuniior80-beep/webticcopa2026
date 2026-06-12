(function(){
  function foldText(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'');
  }

  function normalizeTeamName(name){
    return foldText(name)
      .replace(/^[^\p{L}\p{N}]+\s+/u,'')
      .replace(/[.'’]/g,'')
      .replace(/\s*-\s*/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  const TEAM_ALIASES = {
    'Africa do Sul': 'South Africa',
    'Alemanha': 'Germany',
    'Arabia Saudita': 'Saudi Arabia',
    'Argelia': 'Algeria',
    'Australia': 'Australia',
    'Austria': 'Austria',
    'Belgica': 'Belgium',
    'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
    'Bosnia Herz': 'Bosnia and Herzegovina',
    'Bosnia Herzegovina': 'Bosnia and Herzegovina',
    'Brasil': 'Brazil',
    'Canada': 'Canada',
    'Catar': 'Qatar',
    'Cabo Verde': 'Cape Verde',
    'China': 'China',
    'Colombia': 'Colombia',
    'Coreia do Sul': 'South Korea',
    'Croacia': 'Croatia',
    'Curacao': 'Curacao',
    'Costa do Marfim': 'Ivory Coast',
    'Egito': 'Egypt',
    'Equador': 'Ecuador',
    'Escocia': 'Scotland',
    'Eslovenia': 'Slovenia',
    'Espanha': 'Spain',
    'Estados Unidos': 'United States',
    'EUA': 'United States',
    'Franca': 'France',
    'Gana': 'Ghana',
    'Haiti': 'Haiti',
    'Holanda': 'Netherlands',
    'Indonesia': 'Indonesia',
    'Inglaterra': 'England',
    'Ira': 'Iran',
    'Iraque': 'Iraq',
    'Jordania': 'Jordan',
    'Japao': 'Japan',
    'Korea Republic': 'South Korea',
    'Marrocos': 'Morocco',
    'Mexico': 'Mexico',
    'Nova Zelandia': 'New Zealand',
    'Noruega': 'Norway',
    'Panama': 'Panama',
    'Paraguai': 'Paraguay',
    'Polonia': 'Poland',
    'Republic Of Korea': 'South Korea',
    'Servia': 'Serbia',
    'Suecia': 'Sweden',
    'Suica': 'Switzerland',
    'Tunisia': 'Tunisia',
    'Turquia': 'Turkey',
    'Uzbequistao': 'Uzbekistan',
    'Uruguai': 'Uruguay',
    'USA': 'United States',
    'United States Of America': 'United States',
    'Czechia': 'Czech Republic'
  };

  function normalizeAlias(name){
    const base = normalizeTeamName(name);
    return TEAM_ALIASES[base] || base;
  }

  function pairKey(a,b){
    return [normalizeAlias(a), normalizeAlias(b)]
      .sort((left,right)=>left.localeCompare(right,'pt-BR'))
      .join('__');
  }

  function parseStoredHistoryDate(value){
    if(!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function isPlaceholderTeam(name){
    const team = normalizeAlias(name);
    return /grupo|venc\.|melhor|perdedor|oitava|quarta|semi/i.test(team);
  }

  function pluralize(value, singular, plural){
    return `${value} ${value===1 ? singular : plural}`;
  }

  function buildPlaceholder(){
    return {
      scope: 'Copas do Mundo',
      total: null,
      homeRecord: '0 vitorias',
      awayRecord: '0 vitorias',
      centerRecord: 'Primeiro confronto em Copas do Mundo',
      lastMeeting: '',
      isPlaceholder: true
    };
  }

  function getHeadToHead(home, away){
    if(isPlaceholderTeam(home) || isPlaceholderTeam(away)){
      return buildPlaceholder();
    }

    const archive = (window.COMPETITION_HISTORY_DATA && window.COMPETITION_HISTORY_DATA.worldcup) || [];
    const entry = archive.find(item => pairKey(item.home, item.away) === pairKey(home, away));
    if(!entry){
      return buildPlaceholder();
    }

    const homeName = normalizeAlias(home);
    const awayName = normalizeAlias(away);
    const wins = Object.entries(entry.wins || {}).reduce((acc, [teamName, value]) => {
      acc[normalizeAlias(teamName)] = Number(value || 0);
      return acc;
    }, {});

    return {
      scope: 'Copas do Mundo',
      total: Number(entry.total || 0),
      homeRecord: pluralize(Number(wins[homeName] || 0), 'vitoria', 'vitorias'),
      awayRecord: pluralize(Number(wins[awayName] || 0), 'vitoria', 'vitorias'),
      centerRecord: `${pluralize(Number(entry.draws || 0), 'empate', 'empates')} · ${pluralize(Number(entry.total || 0), 'jogo', 'jogos')}`,
      lastMeeting: entry.lastMeeting ? `Ultimo encontro: ${entry.lastMeeting}` : '',
      lastMeetingAt: parseStoredHistoryDate(entry.lastMeetingAt),
      isPlaceholder: false
    };
  }

  window.HEAD_TO_HEAD = {
    getHeadToHead,
    pairKey,
    normalizeTeamName: normalizeAlias
  };
})();
