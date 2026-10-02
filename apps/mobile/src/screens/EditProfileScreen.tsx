import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ProfileData, ProfileUpdate } from '../services/api';
import { colors, spacing, radius } from '../theme';

const SHOE_BRANDS = [
  'Nike', 'Adidas', 'Asics', 'Brooks', 'Hoka',
  'New Balance', 'Saucony', 'Mizuno', 'On', 'Salomon',
  'Puma', 'Altra', 'Topo', 'Otras',
];

const GENDERS: { value: 'M' | 'F' | 'O'; label: string }[] = [
  { value: 'M', label: 'Hombre' },
  { value: 'F', label: 'Mujer' },
  { value: 'O', label: 'Prefiero no decir' },
];

const DISTANCES: { value: '1-3' | '3-5' | '5-10' | '10+'; label: string }[] = [
  { value: '1-3', label: '1–3 km' },
  { value: '3-5', label: '3–5 km' },
  { value: '5-10', label: '5–10 km' },
  { value: '10+', label: '10 km +' },
];

const FREQUENCIES: { value: '1-2' | '3-4' | '5+'; label: string }[] = [
  { value: '1-2', label: '1–2 / sem' },
  { value: '3-4', label: '3–4 / sem' },
  { value: '5+', label: '5+ / sem' },
];

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 80 }, (_, i) => CURRENT_YEAR - 12 - i); // 12 a 91 años

interface Props {
  visible: boolean;
  initial: ProfileData | null;
  onClose: () => void;
  onSaved: (bonusAwarded: boolean) => void;
}

export default function EditProfileScreen({ visible, initial, onClose, onSaved }: Props) {
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [warCry, setWarCry] = useState('');
  const [shoeBrand, setShoeBrand] = useState<string | null>(null);
  const [shoeBrandOther, setShoeBrandOther] = useState('');
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [gender, setGender] = useState<'M' | 'F' | 'O' | null>(null);
  const [usualDistance, setUsualDistance] = useState<'1-3' | '3-5' | '5-10' | '10+' | null>(null);
  const [weeklyFrequency, setWeeklyFrequency] = useState<'1-2' | '3-4' | '5+' | null>(null);

  const [saving, setSaving] = useState(false);
  const [shoeDropdownOpen, setShoeDropdownOpen] = useState(false);
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);

  // Rellenar campos desde el perfil actual cada vez que se abre.
  useEffect(() => {
    if (!visible || !initial) return;
    setFirstName(initial.first_name ?? '');
    setSurname(initial.surname ?? '');
    setWarCry(initial.war_cry ?? '');
    setShoeBrand(initial.shoe_brand ?? null);
    setShoeBrandOther(initial.shoe_brand_other ?? '');
    setBirthYear(initial.birth_year ?? null);
    setGender(initial.gender ?? null);
    setUsualDistance(initial.usual_distance ?? null);
    setWeeklyFrequency(initial.weekly_frequency ?? null);
  }, [visible, initial]);

  const bonusPending = initial && !initial.profile_bonus_claimed;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload: ProfileUpdate = {
        firstName: firstName.trim() || undefined,
        surname: surname.trim() || undefined,
        warCry: warCry.trim() || undefined,
        shoeBrand: shoeBrand ?? undefined,
        shoeBrandOther: shoeBrand === 'Otras' ? (shoeBrandOther.trim() || undefined) : undefined,
        birthYear: birthYear ?? undefined,
        gender: gender ?? undefined,
        usualDistance: usualDistance ?? undefined,
        weeklyFrequency: weeklyFrequency ?? undefined,
      };
      const res = await api.updateProfile(payload);
      onSaved(!!res.bonusAwarded);
    } catch (err: any) {
      Alert.alert('Error', `No se pudo guardar: ${err?.message ?? 'inténtalo de nuevo'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Editar perfil</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.headerBtn}>
            {saving ? <ActivityIndicator size="small" color={colors.orange} />
              : <Text style={styles.saveBtnText}>Guardar</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Bonus banner — solo si el bonus aún no se ha reclamado */}
          {bonusPending && (
            <View style={styles.bonusBanner}>
              <Ionicons name="gift" size={20} color={colors.orange} />
              <Text style={styles.bonusText}>
                Completa todos los campos para ganar <Text style={styles.bonusHighlight}>+50 pts</Text>
              </Text>
            </View>
          )}

          {/* Email (read-only) */}
          {initial?.email && (
            <View style={styles.field}>
              <Text style={styles.label}>EMAIL</Text>
              <View style={styles.readOnlyValue}>
                <Text style={styles.readOnlyText}>{initial.email}</Text>
              </View>
            </View>
          )}

          {/* Nombre */}
          <View style={styles.field}>
            <Text style={styles.label}>NOMBRE</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Tu nombre"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              maxLength={40}
            />
          </View>

          {/* Apellido */}
          <View style={styles.field}>
            <Text style={styles.label}>APELLIDO</Text>
            <TextInput
              style={styles.input}
              value={surname}
              onChangeText={setSurname}
              placeholder="Tu apellido"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              maxLength={60}
            />
          </View>

          {/* Grito de guerra */}
          <View style={styles.field}>
            <Text style={styles.label}>GRITO DE GUERRA</Text>
            <Text style={styles.hint}>Aparece junto a tu nombre cuando alguien toca tus zonas</Text>
            <TextInput
              style={styles.input}
              value={warCry}
              onChangeText={setWarCry}
              placeholder='Ej: "¡A mi terreno no entras!"'
              placeholderTextColor={colors.textSecondary}
              maxLength={80}
            />
          </View>

          {/* Marca de zapatillas */}
          <View style={styles.field}>
            <Text style={styles.label}>MARCA DE ZAPATILLAS</Text>
            <TouchableOpacity style={styles.dropdown} onPress={() => setShoeDropdownOpen(true)}>
              <Text style={[styles.dropdownText, !shoeBrand && styles.dropdownPlaceholder]}>
                {shoeBrand ?? 'Selecciona una marca'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            {shoeBrand === 'Otras' && (
              <TextInput
                style={[styles.input, { marginTop: spacing.sm }]}
                value={shoeBrandOther}
                onChangeText={setShoeBrandOther}
                placeholder="¿Qué marca?"
                placeholderTextColor={colors.textSecondary}
                maxLength={40}
              />
            )}
          </View>

          {/* Año de nacimiento */}
          <View style={styles.field}>
            <Text style={styles.label}>AÑO DE NACIMIENTO</Text>
            <TouchableOpacity style={styles.dropdown} onPress={() => setYearDropdownOpen(true)}>
              <Text style={[styles.dropdownText, !birthYear && styles.dropdownPlaceholder]}>
                {birthYear ?? 'Selecciona un año'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Sexo */}
          <View style={styles.field}>
            <Text style={styles.label}>SEXO</Text>
            <View style={styles.chipsRow}>
              {GENDERS.map(g => (
                <TouchableOpacity
                  key={g.value}
                  style={[styles.chip, gender === g.value && styles.chipSelected]}
                  onPress={() => setGender(g.value)}
                >
                  <Text style={[styles.chipText, gender === g.value && styles.chipTextSelected]}>{g.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Distancia habitual */}
          <View style={styles.field}>
            <Text style={styles.label}>DISTANCIA HABITUAL</Text>
            <View style={styles.chipsRow}>
              {DISTANCES.map(d => (
                <TouchableOpacity
                  key={d.value}
                  style={[styles.chip, usualDistance === d.value && styles.chipSelected]}
                  onPress={() => setUsualDistance(d.value)}
                >
                  <Text style={[styles.chipText, usualDistance === d.value && styles.chipTextSelected]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Frecuencia semanal */}
          <View style={styles.field}>
            <Text style={styles.label}>FRECUENCIA SEMANAL</Text>
            <View style={styles.chipsRow}>
              {FREQUENCIES.map(f => (
                <TouchableOpacity
                  key={f.value}
                  style={[styles.chip, weeklyFrequency === f.value && styles.chipSelected]}
                  onPress={() => setWeeklyFrequency(f.value)}
                >
                  <Text style={[styles.chipText, weeklyFrequency === f.value && styles.chipTextSelected]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ height: spacing.xl }} />
        </ScrollView>

        {/* Dropdown modal: marcas */}
        <Modal visible={shoeDropdownOpen} transparent animationType="fade" onRequestClose={() => setShoeDropdownOpen(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShoeDropdownOpen(false)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Elige una marca</Text>
              <ScrollView>
                {SHOE_BRANDS.map(brand => (
                  <TouchableOpacity
                    key={brand}
                    style={styles.modalRow}
                    onPress={() => { setShoeBrand(brand); setShoeDropdownOpen(false); }}
                  >
                    <Text style={[styles.modalRowText, shoeBrand === brand && styles.modalRowTextSelected]}>{brand}</Text>
                    {shoeBrand === brand && <Ionicons name="checkmark" size={18} color={colors.orange} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Dropdown modal: años */}
        <Modal visible={yearDropdownOpen} transparent animationType="fade" onRequestClose={() => setYearDropdownOpen(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setYearDropdownOpen(false)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Año de nacimiento</Text>
              <ScrollView>
                {BIRTH_YEARS.map(y => (
                  <TouchableOpacity
                    key={y}
                    style={styles.modalRow}
                    onPress={() => { setBirthYear(y); setYearDropdownOpen(false); }}
                  >
                    <Text style={[styles.modalRowText, birthYear === y && styles.modalRowTextSelected]}>{y}</Text>
                    {birthYear === y && <Ionicons name="checkmark" size={18} color={colors.orange} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 48, paddingBottom: spacing.md, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerBtn: { minWidth: 60 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: colors.orange, textAlign: 'right' },

  scrollContent: { padding: spacing.md, gap: spacing.lg },

  bonusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: `${colors.orange}20`, borderColor: colors.orange, borderWidth: 1,
    padding: spacing.md, borderRadius: radius.md,
  },
  bonusText: { color: colors.textPrimary, flex: 1 },
  bonusHighlight: { color: colors.orange, fontWeight: '800' },

  field: { gap: spacing.xs },
  label: {
    fontSize: 11, fontWeight: '800', color: colors.textSecondary,
    letterSpacing: 1.5,
  },
  hint: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, fontSize: 15,
  },
  readOnlyValue: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    opacity: 0.6,
  },
  readOnlyText: { color: colors.textPrimary, fontSize: 15 },

  dropdown: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
  },
  dropdownText: { color: colors.textPrimary, fontSize: 15 },
  dropdownPlaceholder: { color: colors.textSecondary },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm - 2,
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.full,
  },
  chipSelected: { backgroundColor: colors.orange, borderColor: colors.orange },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#000', fontWeight: '800' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, maxHeight: '70%',
    borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 14, fontWeight: '800', color: colors.textSecondary,
    letterSpacing: 1.5, marginBottom: spacing.sm, textTransform: 'uppercase',
  },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalRowText: { color: colors.textPrimary, fontSize: 15 },
  modalRowTextSelected: { color: colors.orange, fontWeight: '800' },
});
