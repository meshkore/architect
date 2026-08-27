/**
 * ChatBubbles — COMPATIBILITY SHIM, safe to delete.
 *
 * AX13 (cockpit-excellence) moved the bubbles to
 * `~/components/chat/bubbles/` and `CollapsibleText` to
 * `~/components/ui/CollapsibleText` (it is generic clamp+markdown, and
 * roadmap code importing it from the chat file was a roadmap→chat
 * dependency).
 *
 * This file exists only so `InitiativeCard.tsx` keeps compiling while
 * its import is updated. Once nothing imports `~/components/ChatBubbles`,
 * delete it — do not add anything here.
 */

export { CollapsibleText } from '~/components/ui/CollapsibleText';
