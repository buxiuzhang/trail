import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface WeatherNow {
  icon: string
  text: string
  temp: string
  feelsLike: string
  humidity: string
  windDir: string
  windScale: string
  obsTime: string
  districtName: string
}

export interface WeatherSettings {
  project_id: string
  credential_id: string
  api_host: string
  private_key_masked: string
  default_city: string
  default_city_name: string
}

/** 和风天气图标码 → emoji */
export const WEATHER_EMOJI: Record<string, string> = {
  '100': '☀️', '101': '🌤', '102': '🌤', '103': '🌤', '104': '☁️',
  '150': '☀️', '151': '🌤', '152': '🌤', '153': '🌤',
  '300': '🌧', '301': '🌧', '302': '⛈', '303': '⛈',
  '304': '🌧', '305': '🌧', '306': '🌧', '307': '🌧', '308': '🌧',
  '309': '🌧', '310': '🌧', '311': '🌧', '312': '🌧', '313': '🌧',
  '314': '🌧', '315': '🌧', '316': '🌧', '317': '🌧', '318': '🌧',
  '350': '🌧', '351': '🌧',
  '400': '🌨', '401': '🌨', '402': '❄️', '403': '❄️', '404': '🌨',
  '405': '🌨', '406': '🌨', '407': '🌨', '408': '🌨', '409': '🌨',
  '410': '🌨', '456': '🌨', '457': '❄️',
  '500': '🌫', '501': '🌫', '502': '🌫', '503': '🌫', '504': '🌫',
  '507': '🌪', '508': '🌪',
  '900': '🔥', '901': '❄️', '999': '❓',
}

export function useWeather(location: string | null, enabled = true) {
  return useQuery<WeatherNow | null>({
    queryKey: ['weather', location],
    queryFn: async () => {
      const params = location ? `?location=${encodeURIComponent(location)}` : ''
      const res = await fetch(`/api/weather${params}`)
      if (res.status === 204) return null
      if (!res.ok) return null
      return res.json()
    },
    staleTime: 60 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    gcTime: 0,
    enabled,
    retry: false,
  })
}

export function useWeatherSettings() {
  return useQuery({
    queryKey: ['settings', 'weather'],
    queryFn: () => api.get<WeatherSettings>('/api/settings/weather'),
    staleTime: 60_000,
  })
}

export function useSaveWeatherSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<WeatherSettings> & { private_key?: string; location_id?: string }) =>
      api.put('/api/settings/weather', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'weather'] })
    },
  })
}

export function useWeatherProvinces() {
  return useQuery({
    queryKey: ['weather', 'provinces'],
    queryFn: () => api.get<string[]>('/api/settings/weather/cities/provinces'),
    staleTime: Infinity,
  })
}

export function useWeatherAdm2(province: string | null) {
  return useQuery({
    queryKey: ['weather', 'adm2', province],
    queryFn: () => api.get<string[]>(`/api/settings/weather/cities/adm2?province=${encodeURIComponent(province!)}`),
    enabled: !!province,
    staleTime: Infinity,
  })
}

export function useWeatherDistricts(province: string | null, city: string | null) {
  return useQuery({
    queryKey: ['weather', 'districts', province, city],
    queryFn: () => api.get<{ location_id: string; name_zh: string }[]>(
      `/api/settings/weather/cities/districts?province=${encodeURIComponent(province!)}&city=${encodeURIComponent(city!)}`
    ),
    enabled: !!province && !!city,
    staleTime: Infinity,
  })
}

export function useWeatherCityLookup(locationId: string | null) {
  return useQuery({
    queryKey: ['weather', 'lookup', locationId],
    queryFn: () => api.get<{ location_id: string; name_zh: string; adm1_zh: string; adm2_zh: string }>(
      `/api/settings/weather/cities/lookup?locationId=${encodeURIComponent(locationId!)}`
    ),
    enabled: !!locationId,
    staleTime: Infinity,
  })
}
