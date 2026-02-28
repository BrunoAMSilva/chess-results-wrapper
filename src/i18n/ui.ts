export const languages = {
  1: 'en',
  10: 'pt-PT',
};

export const defaultLang = 1;

export const ui = {
  1: {
    'site.title': 'Chess Pairings',
    'header.matches': 'Matches',
    'header.players': 'Players',
    'header.round': 'Rd.',
    'header.prevRound': 'Previous Round',
    'header.nextRound': 'Next Round',
    'error.load': 'Failed to load tournament data',
    'error.hint': 'Check the tournament ID and try again.',
    'table.white': 'WHITE',
    'table.table': 'TABLE',
    'table.black': 'BLACK',
    'match.bye': 'BYE',
    'match.notPaired': 'Not paired',
    'config.title': 'Settings',
    'config.tid': 'Tournament ID',
    'config.lang': 'Language',
    'config.round': 'Round',
    'config.update': 'Update',
    'round.label': 'Round',
    'standings.rank': 'RK',
    'standings.name': 'NAME',
    'standings.fed': 'FED',
    'standings.pts': 'PTS',
    'standings.tb1': 'TB1',
    'standings.tb2': 'TB2',
    'standings.tb3': 'TB3',
    'nav.pairings': 'Pairings',
    'nav.standings': 'Standings',
  },
  10: {
    'site.title': 'Emparceiramentos',
    'header.matches': 'Jogos',
    'header.players': 'Jogadores',
    'header.round': 'Rod.',
    'header.prevRound': 'Ronda Anterior',
    'header.nextRound': 'Próxima Ronda',
    'error.load': 'Erro ao carregar dados do torneio',
    'error.hint': 'Verifique o ID do torneio e tente novamente.',
    'table.white': 'BRANCAS',
    'table.table': 'MESA',
    'table.black': 'PRETAS',
    'match.bye': 'BYE',
    'match.notPaired': 'Não emparceirado',
    'config.title': 'Definições',
    'config.tid': 'ID do Torneio',
    'config.lang': 'Idioma',
    'config.round': 'Ronda',
    'config.update': 'Atualizar',
    'round.label': 'Ronda',
    'standings.rank': 'POS',
    'standings.name': 'NOME',
    'standings.fed': 'FED',
    'standings.pts': 'PTS',
    'standings.tb1': 'TB1',
    'standings.tb2': 'TB2',
    'standings.tb3': 'TB3',
    'nav.pairings': 'Jogos',
    'nav.standings': 'Classificação',
  },
} as const;

export function useTranslations(lang: number) {
  // Fallback to default lang if the requested lang is not supported
  const dict = ui[lang as keyof typeof ui] || ui[defaultLang];
  return function t(key: keyof typeof dict) {
    return dict[key] || ui[defaultLang][key as keyof typeof ui[typeof defaultLang]];
  }
}
