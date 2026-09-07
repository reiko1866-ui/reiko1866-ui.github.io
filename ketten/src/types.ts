export type Coord = {
  lat: number;
  lng: number;
};

export type LocationFix = Coord & {
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  updatedAt: number;
};

export type Member = {
  deviceId: string;
  name: string;
  color: string;
  sharing: boolean;
  online: boolean;
  location: LocationFix | null;
};

export type PairState = {
  pairCode: string;
  you: Member | null;
  partner: Member | null;
  members: Member[];
};

export type Session = {
  deviceId: string;
  name: string;
  pairCode: string | null;
  sharing: boolean;
  relayUrl: string;
  demo: boolean;
  testOffset: boolean;
};

export type MapFocus = 'me' | 'partner' | 'both' | 'free';
