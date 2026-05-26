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
  userId?: string;
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

interface Achievement {
  key: string;
  title: string;
  description: string;
  icon: string;
  category: 'distancia' | 'zonas' | 'carreras' | 'robos' | 'racha';
  target: number;
  progress: number;
  reward: number;
  unlocked: boolean;
  unlockedAt: string | null;
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
  xp?: number;
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
  owner_id?: string;
  owner_name?: string;
  owner_war_cry?: string | null;
  is_mine?: boolean;
}

// ── Grid (v2) ────────────────────────────────────────────────────────────────
interface Cell { x: number; y: number; }

interface RemoteCell {
  cell_x: number;
  cell_y: number;
  owner_id: string;
  owner_name?: string;
  owner_war_cry?: string | null;
  claimed_at?: string;
  is_mine: boolean;
}

interface ProfileData {
  id: string;
  email: string;
  display_name: string;
  city: string | null;
  avatar_url: string | null;
  first_name: string | null;
  surname: string | null;
  war_cry: string | null;
  shoe_brand: string | null;
  shoe_brand_other: string | null;
  birth_year: number | null;
  gender: 'M' | 'F' | 'O' | null;
  usual_distance: '1-3' | '3-5' | '5-10' | '10+' | null;
  weekly_frequency: '1-2' | '3-4' | '5+' | null;
  profile_bonus_claimed: boolean;
}

interface ProfileUpdate {
  displayName?: string;
  city?: string;
  avatarUrl?: string;
  firstName?: string;
  surname?: string;
  warCry?: string;
  shoeBrand?: string;
  shoeBrandOther?: string;
  birthYear?: number;
  gender?: 'M' | 'F' | 'O';
  usualDistance?: '1-3' | '3-5' | '5-10' | '10+';
  weeklyFrequency?: '1-2' | '3-4' | '5+';
}

interface StravaExchangeResult {
  kind: 'login' | 'signup';
  // login
  accessToken?: string;
  user?: { id: string; username: string; email: string; city: string | null };
  // signup
  signupToken?: string;
  prefill?: {
    firstName: string | null;
    lastName: string | null;
    city: string | null;
    gender: 'M' | 'F' | null;
    avatarUrl: string | null;
    bio: string | null;
  };
}

interface TauntInbox {
  id: string;
  mode: 'robo_notif' | 'taunt' | 'response';
  taunt_id: number | null;
  run_id: string | null;
  created_at: string;
  from_user_id: string | null;
  from_user_name: string | null;
}

interface CellRunPayload extends RunPayload {
  claimedCells?: Cell[];
  // Loop closure bonus accumulated client-side during the run. Sent separately
  // so the backend can recompute the authoritative point total with multipliers.
  loopBonus?: number;
}

interface RunSaveResult {
  runId: string;
  stolenZones: { id: string; ownerName: string; points: number }[];
  stolenCells?: { x: number; y: number; prevOwnerId: string; prevOwnerName: string }[];
  newCellCount?: number;
  // Authoritative server-computed final point total + breakdown. Use this for
  // the summary modal instead of the client-side estimate.
  points?: number;
  breakdown?: {
    kmPoints: number;
    cellPoints: number;
    loopBonus: number;
    streakMultiplier: number;
    pbMultiplier: number;
    streakDays: number;
    beatPB: boolean;
  };
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
  bonus_xp?: number;
  // Total XP que el usuario ve: floor(total_points / 100) + bonus_xp.
  // El backend lo computa para evitar que cada cliente lo haga distinto.
  total_xp?: number;
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
      const body = await res.json().catch(() => ({}));
      const err: any = new Error(body.error || `API error ${res.status}`);
      err.body = body;
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async login(email: string, password: string): Promise<{ accessToken: string; user: { id: string; username: string; email: string } }> {
    const res = await this.request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return { accessToken: res.accessToken, user: res.user };
  }

  async loginWithGoogle(idToken: string): Promise<{ accessToken: string; user: { id: string; username: string; email: string } }> {
    const res = await this.request<any>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    return { accessToken: res.accessToken, user: res.user };
  }

  async register(username: string, email: string, password: string, city?: string): Promise<{ accessToken?: string; pendingVerification?: boolean; user?: { id: string; username: string; email: string; city?: string } }> {
    const res = await this.request<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName: username, city }),
    });
    return res;
  }

  async forgotPassword(email: string): Promise<void> {
    await this.request<any>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
    return this.request<{ available: boolean; reason?: string }>(`/auth/check-username?username=${encodeURIComponent(username)}`);
  }

  async resendVerification(email: string): Promise<void> {
    await this.request<any>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async getCitiesRanking(): Promise<RankingEntry[]> {
    try {
      const rows = await this.request<any[]>('/ranking/cities');
      return rows.map((r, i) => ({
        position: i + 1,
        userId: r.user_id,
        username: r.display_name ?? 'Runner',
        city: r.city ?? '',
        points: r.total_points ?? 0,
        zones: r.total_zones ?? 0,
        isCurrentUser: this.userId != null && r.user_id === this.userId,
      }));
    } catch {
      return [];
    }
  }

  async getRankingByCity(city: string): Promise<RankingEntry[]> {
    try {
      const rows = await this.request<any[]>(`/ranking/city?city=${encodeURIComponent(city)}`);
      return rows.map((r, i) => ({
        position: i + 1,
        userId: r.user_id,
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
        userId: r.user_id,
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
      const res = await this.request<Challenge[]>('/challenges');
      return res.length > 0 ? res : MOCK_CHALLENGES;
    } catch {
      return MOCK_CHALLENGES;
    }
  }

  async saveRun(data: CellRunPayload): Promise<RunSaveResult> {
    return this.request<RunSaveResult>('/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCellsInViewport(north: number, south: number, east: number, west: number): Promise<{ cells: RemoteCell[] }> {
    const qs = `north=${north}&south=${south}&east=${east}&west=${west}`;
    return this.request<{ cells: RemoteCell[] }>(`/cells/viewport?${qs}`);
  }

  /** Listado paginado de todas las carreras del usuario. Usado por la pantalla
   *  "Ver más" desde Stats. Devuelve total para paginar correctamente. */
  async getAllRuns(limit = 30, offset = 0): Promise<{ runs: RunRecord[]; total: number; limit: number; offset: number }> {
    return this.request<{ runs: RunRecord[]; total: number; limit: number; offset: number }>(
      `/runs/my?limit=${limit}&offset=${offset}`
    );
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

  async getProfile(): Promise<ProfileData> {
    return this.request<ProfileData>('/users/me');
  }

  async updateProfile(data: ProfileUpdate): Promise<{ ok: true; bonusAwarded?: boolean }> {
    return this.request<{ ok: true; bonusAwarded?: boolean }>('/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getAchievements(): Promise<Achievement[]> {
    return this.request<Achievement[]>('/achievements');
  }

  async deleteAccount(): Promise<void> {
    await this.request('/users/me', { method: 'DELETE' });
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

  // Strava signup/login mobile flow (v1.9). Pasos:
  //   1) getStravaSignupUrl → url que se abre en browser
  //   2) Browser redirige al deep link corrr://strava-auth?temp=JWT
  //   3) App captura el temp y llama a stravaExchange(temp)
  //   4) Si kind === 'login' → usar accessToken directamente
  //   5) Si kind === 'signup' → mostrar form con prefill, llamar stravaRegister al guardar
  // Strava signup mobile endpoints son públicos (no requieren auth Bearer). El
  // método `request` añade el token si existe; si el usuario no está logueado
  // todavía, simplemente no se añade — perfecto para este flujo.
  async getStravaSignupUrl(): Promise<string> {
    const data = await this.request<{ url: string }>('/auth/strava/mobile-init');
    return data.url;
  }
  async stravaExchange(temp: string): Promise<StravaExchangeResult> {
    return this.request<StravaExchangeResult>('/auth/strava/exchange', {
      method: 'POST',
      body: JSON.stringify({ temp }),
    });
  }
  async stravaRegister(data: {
    signupToken: string; email: string; password: string; displayName: string;
    firstName?: string; surname?: string; city?: string; gender?: 'M' | 'F' | 'O';
  }): Promise<LoginResponse & { pendingVerification?: boolean }> {
    return this.request<LoginResponse & { pendingVerification?: boolean }>('/auth/strava/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Taunts (emote chat after robos)
  async getUnreadTaunts(): Promise<{ taunts: TauntInbox[] }> {
    return this.request<{ taunts: TauntInbox[] }>('/taunts/unread');
  }
  async sendTaunt(toUserId: string, tauntId: number, mode: 'taunt' | 'response', runId?: string): Promise<{ id: string; createdAt: string }> {
    return this.request('/taunts', {
      method: 'POST',
      body: JSON.stringify({ toUserId, tauntId, mode, runId }),
    });
  }
  async markTauntsRead(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.request('/taunts/read', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
  }

  // Friends
  async sendFriendRequest(receiverId: string): Promise<{ status: string; message: string }> {
    return this.request('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ receiverId }),
    });
  }

  async getPendingFriendRequests(): Promise<FriendRequest[]> {
    return this.request('/friends/pending');
  }

  async respondFriendRequest(id: string, action: 'accept' | 'reject'): Promise<void> {
    await this.request(`/friends/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ action }),
    });
  }

  async getFriends(): Promise<Friend[]> {
    return this.request('/friends');
  }

  async removeFriend(userId: string): Promise<void> {
    await this.request(`/friends/${userId}`, { method: 'DELETE' });
  }
}

interface FriendRequest {
  id: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
}

interface Friend {
  user_id: string;
  display_name: string;
  city: string;
  total_points: number;
  total_zones: number;
}

export const api = new ApiService();
export type { LoginResponse, RankingEntry, Challenge, Achievement, RunRecord, UserStats, MyStats, RemoteZone, ZonePayload, FriendRequest, Friend, Cell, RemoteCell, CellRunPayload, RunSaveResult, TauntInbox, ProfileData, ProfileUpdate };

const MOCK_RANKING: RankingEntry[] = [
  { position: 1, username: 'Laura R.', city: 'Barcelona', points: 28480, zones: 87 },
  { position: 2, username: 'Álex M.', city: 'Madrid', points: 25190, zones: 74 },
  { position: 3, username: 'Marina G.', city: 'Valencia', points: 23740, zones: 68 },
  { position: 4, username: 'PauGC', city: 'Sevilla', points: 17560, zones: 52 },
  { position: 5, username: 'SergioRun', city: 'Bilbao', points: 16230, zones: 48 },
  { position: 6, username: 'CarlosP', city: 'Zaragoza', points: 14540, zones: 43 },
  { position: 7, username: 'Pau Trail', city: 'Valencia', points: 13280, zones: 39 },
  { position: 8, username: 'Nerea_24', city: 'Málaga', points: 11980, zones: 35 },
  { position: 23, username: 'Tú', city: 'Barcelona', points: 4250, zones: 12, isCurrentUser: true },
];

const MOCK_CHALLENGES: Challenge[] = [
  { id: '1', title: 'El gran círculo', description: 'Captura 1 zona circular de 10 km.', type: 'shape', progress: 7, total: 10, reward: 600, icon: '⭕' },
  { id: '2', title: 'La estrella', description: 'Dibuja una estrella de 5 puntas.', type: 'shape', progress: 2, total: 5, reward: 800, icon: '⭐' },
  { id: '3', title: 'Corredor infinito', description: 'Dibuja el símbolo del infinito.', type: 'shape', progress: 1, total: 3, reward: 500, icon: '∞' },
  { id: '4', title: '100 km este mes', description: 'Acumula 100 km en carreras.', type: 'distance', progress: 68, total: 100, reward: 1000, icon: '💯' },
  { id: '5', title: 'Ladrón de zonas', description: 'Roba 5 zonas a rivales.', type: 'steal', progress: 3, total: 5, reward: 700, icon: '🎭' },
];
