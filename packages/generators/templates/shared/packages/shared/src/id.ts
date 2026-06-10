import { customAlphabet } from "nanoid";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 24;

export const createId = customAlphabet(ID_ALPHABET, ID_LENGTH);
