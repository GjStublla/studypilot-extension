import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { STUDY_FOLDERS, type ContextShareSettings, type PageContext, type StudyFolder } from '@/shared/types';

export function SettingsSheet({
  page,
  context,
  onChange,
  onOpenDashboard,
}: {
  page: PageContext;
  context: ContextShareSettings;
  onChange: Dispatch<SetStateAction<ContextShareSettings>>;
  onOpenDashboard: () => void;
}) {
  const setFlag =
    (key: keyof Pick<ContextShareSettings, 'screenshot' | 'pageUrl' | 'selectedText' | 'saveToDashboard'>) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange((prev) => ({ ...prev, [key]: event.target.checked }));
    };

  return (
    <section className="sp-settings">
      <div className="sp-settings-title">
        <ShieldCheck size={14} />
        <span>Shared when you ask or save</span>
      </div>

      <p className="sp-settings-copy">
        Microphone audio is sent to Google Vertex AI while Live is active. Screenshots are sent only when enabled. Chat
        and session history save only when “Save to dashboard” is enabled.
      </p>

      <div className="sp-settings-group">
        <p className="sp-settings-group-label">Page context</p>
        <div className="sp-settings-toggles">
          <TogglePill name="pageUrl" label="Page URL" checked={context.pageUrl} onChange={setFlag('pageUrl')} />
          <TogglePill
            name="selectedText"
            label={page.selectedText ? 'Selected text' : 'No selection'}
            checked={context.selectedText}
            onChange={setFlag('selectedText')}
          />
        </div>
      </div>

      <div className="sp-settings-group">
        <p className="sp-settings-group-label">Capture and saving</p>
        <div className="sp-settings-toggles">
          <TogglePill
            name="screenshot"
            label={context.screenshot ? 'Screenshot on' : 'No screenshot'}
            checked={context.screenshot}
            onChange={setFlag('screenshot')}
          />
          <TogglePill
            name="saveToDashboard"
            label="Save to dashboard"
            checked={context.saveToDashboard}
            onChange={setFlag('saveToDashboard')}
          />
        </div>
      </div>

      <div className="sp-settings-row">
        <label className="sp-folder">
          <span>Folder</span>
          <select
            value={context.folder}
            onChange={(event) =>
              onChange((prev) => ({
                ...prev,
                folder: event.target.value as StudyFolder,
              }))
            }
          >
            {STUDY_FOLDERS.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="sp-dashboard-link" onClick={onOpenDashboard}>
          <ExternalLink size={14} />
          <span>Dashboard</span>
        </button>
      </div>
    </section>
  );
}

function TogglePill({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="sp-toggle" data-checked={checked}>
      <input type="checkbox" name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
