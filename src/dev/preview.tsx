// Dev-only harness: renders the panel on a plain page (no extension runtime)
// so the UI can be previewed and screenshotted at http://127.0.0.1:5179/src/dev/preview.html
import { mountStudyPilot } from '@/content/mount';

mountStudyPilot({ defaultOpen: true });
