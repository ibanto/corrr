import { API_BASE } from '../theme';

interface LoginResponse {
  accessToken: string;
  userId: string;
  user?: {
    id: string;
    email: string;
    username: string;
  };
}

interface RankingEntry {
  position: number;
  username: string;
  city: string;
  points: number;
  zones: number;
  isCurrentUser?: boolean;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'shape' | 'distance' | 'streak' | 'steal';
  progress: number;
  total: number;
  reward: number;
  icon: string;
}

interface ZoneCoord {
  latitude: number;
  longitude: number;
}

interface ZonePayload {
  coords: ZoneCoord[];
  area: number;
  points: number;
}

interface RunPayload {
  distanceKm: number;
  durationSecs: number;
  points: number;
  zonesCount: number;
  zones: ZonePayload[];
}

interface RemoteZone {
  id: string;
  polygon: ZoneCoord[];
  area_km2: number;
  points: number;
  center_lat: number;
  center_lng: number;
  conquered_at?: string;
  owner_name?: string;
  is_mine?: boolean;
}

interface RunRecord {
  id: string;
  distance_km: number;
  duration_secs: number;
  points: number;
  zones_count: number;
  created_at: string;
}

interface UserStats {
  total_zones: number;
  total_points: number;
  total_km: number;
  total_runs: number;
}

interface MyStats {
  stats: UserStats;
  runs: RunRecord[];
}

class ApiService {
  private token: string | null = null;
  userId: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  setUserId(id: string) {
    this.userId = id;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });
    if (!res.ok) {
      throw new Error(`API error ${res.status}`);
    }
    return res.json();
  }

  async login(email: string, password: string): Promise<{ accessToken: string; user: { id: string; username: string; email: string } }> {
    const res = await this.request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return {
      accessToken: res.accessToken,
      user: { id: res.userId, username: email.split('@')[0], email },
    };
  }

  async register(username: string, email: string, password: string, city?: string): Promise<{ accessToken: string; user: { id: string; username: string; email: string; city?: string } }> {
    const res = await this.request<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName: username, city }),
    });
    return {
      accessToken: res.accessToken,
      user: { id: res.userId, username, email, city },
    };
  }

  async getRankingByCity(city: string): Promise<RankingEntry[]> {
    try {
      const rows = await this.request<any[]>(`/ranking/city?city=${encodeURIComponent(city)}`);
      return rows.map((r, i) => ({
        position: i + 1,
        username: r.display_name ?? 'Runner',
        city: r.city ?? city,
        points: r.total_points ?? 0,
        zones: r.total_zones ?? 0,
        isCurrentUser: this.userId != null && r.user_id === this.userId,
      }));
    } catch {
      return [];
    }
  }

  async getRanking(): Promise<RankingEntry[]> {
    try {
      const rows = await this.request<any[]>('/ranking/global');
      return rows.map((r, i) => ({
        position: i + 1,
        username: r.display_name ?? 'Runner',
        city: r.city ?? 'España',
        points: r.total_points ?? 0,
        zones: r.total_zones ?? 0,
        isCurrentUser: this.userId != null && r.user_id === this.userId,
      }));
    } catch {
      return MOCK_RANKING;
    }
  }

  async getChallenges(): Promise<Challenge[]> {
    try {
      return await this.request<Challenge[]>('/challenges');
    } catch {
      return MOCK_CHALLENGES;
    }
  }

  async saveRun(data: RunPayload): Promise<{ runId: string; stolenZones: { id: string; ownerName: string; points: number }[] }> {
    return this.request<any>('/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMyStats(): Promise<MyStats> {
    return this.request<MyStats>('/stats/me');
  }

  async getMyZones(): Promise<RemoteZone[]> {
    return this.request<RemoteZone[]>('/zones/my');
  }

  async getNearbyZones(lat: number, lng: number): Promise<RemoteZone[]> {
    return this.request<RemoteZone[]>(`/zones/nearby?lat=${lat}&lng=${lng}&radius=0.05`);
  }

  async savePushToken(token: string): Promise<void> {
    await this.request('/users/push-token', {
      method: 'POST',
      body: JSON.stringify({ pushToken: token }),
    });
  }

  async getStravaAuthUrl(): Promise<string> {
    const data = await this.request<{ url: string }>('/auth/strava');
    return data.url;
  }
}

export const api = new ApiService();
export type { LoginResponse, RankingEntry, Challenge, RunRecord, UserStats, MyStats, RemoteZone, ZonePayload };

const MOCK_RANKING: RankingEntry[] = [
  { position: 1, username: 'Laura R.', city: 'Barcelona', points: 28480, zones: 87 },
  { position: 2, username: 'Álex M.', city: 'Madrid', points: 25190, zones: 74 },
  { position: 3, username: 'Marina G.', city: 'Valencia', points: 23740, zones: 68 },
  { position: 4, username: 'PauGC', city: 'Sevilla', points: 17560, zones: 52 },
  { position: 5, username: 'SergioRun', city: 'Bilbao', points: 16230, zones: 48 },
  { position: 6, username: 'CarlosP', city: 'Zaragoza', points: 14540, zones: 43 },
  { position: 7, username: 'Pau Trail', city: 'Valencia', points: 13280, zones: 39 },
  { position: 8, username: 'Nerea_24', city: 'Málaga', points: 11980, zones: 35 },
  { position: 23, username: 'Tú', city: 'Madrid', points: 4250, zones: 12, isCurrentUser: true },
];

const MOCK_CHALLENGES: Challenge[] = [
  { id: '1', title: 'El gran círculo', description: 'Captura 1 zona circular de 10 km.', type: 'shape', progress: 7, total: 10, reward: 600, icon: '⭕' },
  { id: '2', title: 'La estrella de Madrid', description: 'Dibuja una estrella de 5 puntas.', type: 'shape', progress: 2, total: 5, reward: 800, icon: '⭐' },
  { id: '3', title: 'Corredor infinito', description: 'Dibuja el símbolo del infinito.', type: 'shape', progress: 1, total: 3, reward: 500, icon: '∞' },
  { id: '4', title: '100 km este mes', description: 'Acumula 100 km en carreras.', type: 'distance', progress: 68, total: 100, reward: 1000, icon: '💯' },
  { id: '5', title: 'Ladrón de zonas', description: 'Roba 5 zonas a rivales.', type: 'steal', progress: 3, total: 5, reward: 700, icon: '🎭' },
];
