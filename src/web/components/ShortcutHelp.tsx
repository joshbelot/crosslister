import { Modal } from './Modal';

const ROWS: Array<[string, string]> = [
  ['N', 'New listing'], ['A', 'Toggle Activity drawer'], ['G then I / S / L', 'Go to Inventory / Settings / Logs'], ['?', 'This help'],
  ['/', 'Inventory: focus search'], ['J / K, Enter, E', 'Inventory: move, open, edit'],
  ['⌘S', 'Editor: save now'], ['⌘Enter', 'Editor/Detail: cross-list'], ['⌘O', 'Editor: choose photos'], ['⌘V', 'Editor: paste photos'],
  ['1–6', 'Editor: condition (when focused)'], ['E', 'Detail: edit'], ['Esc / Enter', 'Modals: close / primary action'],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="w-full text-sm">
        <tbody>
          {ROWS.map(([k, d]) => (
            <tr key={k} className="border-b border-zinc-100 last:border-0">
              <td className="w-48 py-2 pr-3"><span className="kbd">{k}</span></td>
              <td className="py-2 text-zinc-700">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
