import WhatsAppIcon from '../../common/icons/WhatsAppIcon.jsx';
import { taskIcon } from './taskConfig.js';

// Renders a task-type icon. WhatsApp tasks (by icon key OR channel) use the real
// shared WhatsApp mark; everything else uses its emoji. Kept as a component so
// the WhatsApp SVG renders consistently everywhere (the plain string helper is
// still used where only text can render, e.g. <option> labels).
export default function TaskIcon({ name, channel, size = 16 }) {
  if (name === 'whatsapp' || channel === 'whatsapp') {
    return (
      <span className="inline-flex items-center leading-none align-middle">
        <WhatsAppIcon size={size} />
      </span>
    );
  }
  return <span aria-hidden>{taskIcon(name)}</span>;
}
