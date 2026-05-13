export interface Zone {
  id: string;
  name: string;
  district: string;
  coords: { latitude: number; longitude: number }[];
  color?: string;
}

export const MADRID_ZONES: Zone[] = [
  {
    id: 'sol',
    name: 'Sol',
    district: 'Centro',
    coords: [
      { latitude: 40.4168, longitude: -3.7038 },
      { latitude: 40.4185, longitude: -3.7055 },
      { latitude: 40.4195, longitude: -3.7035 },
      { latitude: 40.4188, longitude: -3.7010 },
      { latitude: 40.4168, longitude: -3.7012 },
      { latitude: 40.4155, longitude: -3.7025 },
    ]
  },
  {
    id: 'malasana',
    name: 'Malasaña',
    district: 'Centro',
    coords: [
      { latitude: 40.4255, longitude: -3.7080 },
      { latitude: 40.4268, longitude: -3.7055 },
      { latitude: 40.4262, longitude: -3.7020 },
      { latitude: 40.4240, longitude: -3.7005 },
      { latitude: 40.4218, longitude: -3.7018 },
      { latitude: 40.4215, longitude: -3.7052 },
      { latitude: 40.4228, longitude: -3.7075 },
    ]
  },
  {
    id: 'chueca',
    name: 'Chueca',
    district: 'Centro',
    coords: [
      { latitude: 40.4240, longitude: -3.7005 },
      { latitude: 40.4252, longitude: -3.6982 },
      { latitude: 40.4248, longitude: -3.6955 },
      { latitude: 40.4228, longitude: -3.6948 },
      { latitude: 40.4210, longitude: -3.6962 },
      { latitude: 40.4208, longitude: -3.6990 },
      { latitude: 40.4218, longitude: -3.7018 },
    ]
  },
  {
    id: 'lavapies',
    name: 'Lavapiés',
    district: 'Centro',
    coords: [
      { latitude: 40.4118, longitude: -3.7068 },
      { latitude: 40.4128, longitude: -3.7045 },
      { latitude: 40.4122, longitude: -3.7018 },
      { latitude: 40.4105, longitude: -3.7005 },
      { latitude: 40.4088, longitude: -3.7015 },
      { latitude: 40.4082, longitude: -3.7042 },
      { latitude: 40.4092, longitude: -3.7065 },
    ]
  },
  {
    id: 'retiro',
    name: 'Retiro',
    district: 'Retiro',
    coords: [
      { latitude: 40.4155, longitude: -3.6862 },
      { latitude: 40.4175, longitude: -3.6808 },
      { latitude: 40.4148, longitude: -3.6762 },
      { latitude: 40.4112, longitude: -3.6758 },
      { latitude: 40.4085, longitude: -3.6798 },
      { latitude: 40.4088, longitude: -3.6848 },
      { latitude: 40.4118, longitude: -3.6875 },
    ]
  },
  {
    id: 'salamanca',
    name: 'Salamanca',
    district: 'Salamanca',
    coords: [
      { latitude: 40.4252, longitude: -3.6890 },
      { latitude: 40.4268, longitude: -3.6828 },
      { latitude: 40.4248, longitude: -3.6768 },
      { latitude: 40.4215, longitude: -3.6755 },
      { latitude: 40.4188, longitude: -3.6775 },
      { latitude: 40.4182, longitude: -3.6848 },
      { latitude: 40.4202, longitude: -3.6902 },
    ]
  },
  {
    id: 'chamberi',
    name: 'Chamberí',
    district: 'Chamberí',
    coords: [
      { latitude: 40.4342, longitude: -3.7042 },
      { latitude: 40.4358, longitude: -3.6995 },
      { latitude: 40.4348, longitude: -3.6945 },
      { latitude: 40.4318, longitude: -3.6928 },
      { latitude: 40.4288, longitude: -3.6942 },
      { latitude: 40.4272, longitude: -3.6985 },
      { latitude: 40.4282, longitude: -3.7035 },
      { latitude: 40.4312, longitude: -3.7055 },
    ]
  },
  {
    id: 'arganzuela',
    name: 'Arganzuela',
    district: 'Arganzuela',
    coords: [
      { latitude: 40.4058, longitude: -3.7068 },
      { latitude: 40.4065, longitude: -3.7025 },
      { latitude: 40.4042, longitude: -3.6988 },
      { latitude: 40.4015, longitude: -3.6982 },
      { latitude: 40.3988, longitude: -3.7005 },
      { latitude: 40.3982, longitude: -3.7048 },
      { latitude: 40.4005, longitude: -3.7082 },
    ]
  },
  {
    id: 'carabanchel',
    name: 'Carabanchel',
    district: 'Carabanchel',
    coords: [
      { latitude: 40.3862, longitude: -3.7342 },
      { latitude: 40.3888, longitude: -3.7255 },
      { latitude: 40.3858, longitude: -3.7168 },
      { latitude: 40.3812, longitude: -3.7145 },
      { latitude: 40.3768, longitude: -3.7188 },
      { latitude: 40.3762, longitude: -3.7298 },
      { latitude: 40.3808, longitude: -3.7362 },
    ]
  },
  {
    id: 'tetuan',
    name: 'Tetuán',
    district: 'Tetuán',
    coords: [
      { latitude: 40.4488, longitude: -3.7042 },
      { latitude: 40.4505, longitude: -3.6985 },
      { latitude: 40.4488, longitude: -3.6928 },
      { latitude: 40.4455, longitude: -3.6912 },
      { latitude: 40.4422, longitude: -3.6935 },
      { latitude: 40.4415, longitude: -3.6995 },
      { latitude: 40.4438, longitude: -3.7048 },
    ]
  },
  {
    id: 'moncloa',
    name: 'Moncloa',
    district: 'Moncloa',
    coords: [
      { latitude: 40.4388, longitude: -3.7242 },
      { latitude: 40.4415, longitude: -3.7158 },
      { latitude: 40.4395, longitude: -3.7075 },
      { latitude: 40.4358, longitude: -3.7055 },
      { latitude: 40.4318, longitude: -3.7082 },
      { latitude: 40.4305, longitude: -3.7168 },
      { latitude: 40.4328, longitude: -3.7255 },
    ]
  },
  {
    id: 'latina',
    name: 'La Latina',
    district: 'Centro',
    coords: [
      { latitude: 40.4118, longitude: -3.7158 },
      { latitude: 40.4135, longitude: -3.7112 },
      { latitude: 40.4122, longitude: -3.7068 },
      { latitude: 40.4092, longitude: -3.7065 },
      { latitude: 40.4068, longitude: -3.7082 },
      { latitude: 40.4062, longitude: -3.7128 },
      { latitude: 40.4082, longitude: -3.7162 },
    ]
  },
];
