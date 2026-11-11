import type { LanguageCode } from '../shared/types';

export type NavSectionId =
  | 'brief'
  | 'brain'
  | 'chat'
  | 'swarm'
  | 'orbit'
  | 'mcp'
  | 'workflows'
  | 'workspace'
  | 'memory'
  | 'skills'
  | 'devices'
  | 'authority';

const TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  'pt-PT': {
    nav_group_command: 'Comando & Cognição',
    nav_group_engineering: 'Engenharia & Enxame',
    nav_group_ecosystem: 'Ecossistema & Máquina',
    nav_brief: 'Briefing & Q-18',
    nav_brain: 'Cérebro Jarvis',
    nav_chat: 'Salas de Agentes',
    nav_swarm: 'Swarm 48x & 3D',
    nav_orbit: 'Orbit Agent OS',
    nav_mcp: 'Gateway MCP',
    nav_workflows: 'Workflows & Cron',
    nav_workspace: 'Workspace & Git',
    nav_memory: 'Memória HippoRAG',
    nav_skills: 'Skills & Canais',
    nav_devices: 'Sidecar & Host',
    nav_authority: 'Autoridade & Definições',
    focus_mode_btn: 'Modo Foco',
    focus_mode_on: 'Foco Ativo',
    focus_mode_toast_on: 'Modo Foco ativado — navegação condensada aos módulos críticos.',
    focus_mode_toast_off: 'Modo Foco desativado — todos os 12 módulos visíveis.',
    cmd_palette_btn: 'Comandos',
    setup_banner_title:
      'Bem-vindo ao J.A.R.V.I.S. Cortex OS v3.0 — conclua a calibração inicial de autonomia, idioma e voz Mark-VII.',
    setup_banner_skip: 'Ignorar',
    setup_banner_open: 'Configurar Agora',
    speak_brief: 'Ouvir Briefing',
    refresh_brief: 'Sintetizar Briefing',
    execute_now: 'Executar Agora',
    verify_now: 'Validar Agora',
  },
  'en-US': {
    nav_group_command: 'Command & Cognition',
    nav_group_engineering: 'Engineering & Swarm',
    nav_group_ecosystem: 'Ecosystem & Host',
    nav_brief: 'Brief & Q-18',
    nav_brain: 'Jarvis Brain',
    nav_chat: 'Agent Rooms',
    nav_swarm: 'Swarm 48x & 3D',
    nav_orbit: 'Orbit Agent OS',
    nav_mcp: 'MCP Gateway',
    nav_workflows: 'Workflows & Cron',
    nav_workspace: 'Workspace & Git',
    nav_memory: 'HippoRAG Memory',
    nav_skills: 'Skills & Channels',
    nav_devices: 'Sidecar & Host',
    nav_authority: 'Authority & Settings',
    focus_mode_btn: 'Focus Mode',
    focus_mode_on: 'Focus On',
    focus_mode_toast_on: 'Focus Mode enabled — sidebar condensed to mission-critical modules.',
    focus_mode_toast_off: 'Focus Mode disabled — all 12 modules visible.',
    cmd_palette_btn: 'Commands',
    setup_banner_title:
      'Welcome to J.A.R.V.I.S. Cortex OS v3.0 — complete initial calibration for autonomy, language, and Mark-VII voice.',
    setup_banner_skip: 'Skip',
    setup_banner_open: 'Configure Now',
    speak_brief: 'Speak Brief',
    refresh_brief: 'Synthesize Brief',
    execute_now: 'Execute Now',
    verify_now: 'Verify Now',
  },
};

export function t(lang: LanguageCode, key: string): string {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS['pt-PT'];
  return dict[key] ?? TRANSLATIONS['pt-PT'][key] ?? key;
}
