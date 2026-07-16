import React, { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { useTheme } from '../theme-context';
import type { RelayFormField } from '../types';

export function RelayForm({
  title,
  fields,
  onSubmit,
  onCancel,
}: {
  title: string;
  fields: RelayFormField[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}): React.ReactNode {
  const colors = useTheme();
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.key] = f.defaultValue || '';
    return initial;
  });
  const [current, setCurrent] = useState(fields[0]?.defaultValue || '');
  const [validationError, setValidationError] = useState<string | null>(null);

  useKeyboard((key) => {
    if (key.name === 'escape') onCancel();
  });

  const field = fields[stepIndex];

  const handleSubmitField = (value: string): void => {
    if (field.required && value.trim() === '') {
      setValidationError(`${field.label} is required`);
      return;
    }
    setValidationError(null);

    const updated = { ...values, [field.key]: value };
    setValues(updated);

    const nextIndex = stepIndex + 1;
    if (nextIndex < fields.length) {
      setStepIndex(nextIndex);
      setCurrent(fields[nextIndex]?.defaultValue || '');
    } else {
      onSubmit(updated);
    }
  };

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <text attributes={1}>{title}</text>
      <text fg={colors.muted}>(Esc to cancel)</text>
      <text> </text>
      {fields.map((f, i) => (
        <box key={f.key} style={{ flexDirection: 'column', marginBottom: i === stepIndex ? 0 : 1 }}>
          {i < stepIndex ? (
            <text fg={colors.succeeded}>
              ✓ {f.label}: {values[f.key] || '(none)'}
            </text>
          ) : null}
          {i === stepIndex ? (
            <box style={{ flexDirection: 'column' }}>
              <text fg={colors.accent}>{f.label}</text>
              <box style={{ border: true, borderColor: colors.accent, flexDirection: 'row' }}>
                <input
                  value={current}
                  focused
                  onInput={setCurrent}
                  {...({ onSubmit: handleSubmitField } as Record<string, unknown>)}
                  placeholder={f.required ? '(required)' : '(optional)'}
                  width={40}
                />
              </box>
            </box>
          ) : null}
        </box>
      ))}
      {validationError ? <text fg={colors.failed}>{validationError}</text> : null}
    </box>
  );
}
