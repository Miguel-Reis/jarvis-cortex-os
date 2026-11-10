import React, { useState } from 'react';
import { X, ArrowRight, Check } from 'lucide-react';
import type { AppSettings, AutonomyLevel, PersonalityMode } from '../shared/types';

interface WelcomeWizardModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (updates: Partial<AppSettings>, initialGoalTitle?: string) => Promise<void>;
}

export const WelcomeWizardModal: React.FC<WelcomeWizardModalProps> = ({
  open,
  settings,
  onClose,
  onSave,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [operatorName, setOperatorName] = useState(settings.operatorName);
  const [organizationName, setOrganizationName] = useState(settings.organizationName);
  const [personalityMode, setPersonalityMode] = useState<PersonalityMode>(settings.personalityMode);
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>(settings.autonomyLevel);
  const [newGoalTitle, setNewGoalTitle] = useState('');

  if (!open) return null;

  const handleSkip = async () => {
    await onSave({ onboardingCompleted: true });
    onClose();
  };

  const handleFinish = async () => {
    await onSave(
      {
        operatorName: operatorName.trim() || 'Comandante',
        organizationName: organizationName.trim() || 'Stark Obsidian Lab',
        personalityMode,
        autonomyLevel,
        onboardingCompleted: true,
      },
      newGoalTitle.trim() || undefined
    );
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Assistente Rápido de Boas-Vindas"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0d1117] border border-slate-800 rounded-xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-cyan-400 font-medium">Passo {step} de 3 · Configuração Rápida</p>
            <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
              Personalizar J.A.R.V.I.S. Cortex OS v2.0
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar assistente"
            className="p-1 text-slate-400 hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Como deve o Jarvis tratar-te?
              </label>
              <input
                type="text"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Laboratório / Equipa / Organização
              </label>
              <input
                type="text"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Objetivo Prioritário Adicional (Opcional)
              </label>
              <input
                type="text"
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                placeholder="Ex.: Automatizar deploys diários e auditoria de segurança"
                className="w-full px-3 py-2 text-sm bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Perfil de Personalidade Cognitiva
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['STARK_EXECUTIVE', 'Stark Executivo'],
                    ['TACTICAL_ENGINEER', 'Engenheiro Tático'],
                    ['WAR_ROOM_CONCISE', 'War Room Conciso'],
                    ['GUARDIAN_DEFENSE', 'Guardião Zero-Trust'],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPersonalityMode(val)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${
                      personalityMode === val
                        ? 'bg-cyan-500/15 border-cyan-500 text-cyan-200'
                        : 'bg-[#151c26] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Nível de Autonomia e Governação de Execução
            </label>
            {(
              [
                [
                  'SAFE_SUPERVISED',
                  'Supervisionado Estrito',
                  'Pede aprovação humana para qualquer comando não listado como leitura.',
                ],
                [
                  'BALANCED_PROACTIVE',
                  'Equilibrado Proativo (Recomendado)',
                  'Executa diagnósticos e testes automaticamente; retém comandos mutáveis na Inbox.',
                ],
                [
                  'FULL_EXECUTIVE',
                  'Autonomia Executiva Total',
                  'Autoriza workflows e comandos locais sem pausa, mantendo bloqueio anti-injeção Canary.',
                ],
              ] as const
            ).map(([val, title, desc]) => (
              <button
                key={val}
                type="button"
                onClick={() => setAutonomyLevel(val)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  autonomyLevel === val
                    ? 'bg-cyan-500/15 border-cyan-500'
                    : 'bg-[#151c26] border-slate-800 hover:border-slate-700'
                }`}
              >
                <p className="text-xs font-semibold text-slate-100">{title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-4"
          >
            Saltar e usar dados pré-configurados
          </button>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="px-3 py-2 text-xs font-medium text-slate-300 bg-[#151c26] rounded-lg hover:text-white"
              >
                Anterior
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors"
              >
                Seguinte
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-500 text-slate-950 rounded-lg hover:bg-emerald-400 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Concluir Configuração
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
