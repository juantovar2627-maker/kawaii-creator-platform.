export type Photo = {
  id: string;
  description: string;
  width: number | null;
  height: number | null;
  state: string;
  scanStatus: string;
  error: string | null;
};
