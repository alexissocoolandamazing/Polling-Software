import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const participantCookieName = (code: string) => `pulse_participant_${code}`;
export const createParticipantToken = () => randomBytes(32).toString("base64url");
export const hashParticipantToken = (token: string) => createHash("sha256").update(token).digest("hex");
