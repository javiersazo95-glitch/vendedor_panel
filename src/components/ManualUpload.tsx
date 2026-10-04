import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Copy, Globe, PlusCircle, Trash2, X, Image as ImageIcon, Upload } from 'lucide-react';
import type { Product } from '../db';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL, DEFAULT_PRODUCT_IMAGE_URL, resolveImageUri } from '../utils/imageHelper';
import { calculateSellerEarnings, calculateSuggestedPrice, pricingFeeBreakdown, serviceFeeAmount, FLOW_RATE_BASE } from '../utils/pricing';
import { useFocusTrap } from '../utils/useFocusTrap';
import { claveCatalogo, mismoNombreCatalogo, nombresUnicosOrdenados } from '../utils/nombresCatalogoVehiculo';
import { formatearEtiquetaMotor, sonMotoresEquivalentes } from '../utils/catalogoVersiones';

function sanitizeCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9\-_/]/g, '');
}

interface ManualUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Omit<Product, 'id' | 'lastUpdated'> & { id?: string }, imageFiles?: File[] | null) => Promise<void>;
  editProduct?: Product | null;
  founder?: boolean;
  /**
   * "Ver en inventario" del resultado. Abierto desde "Cargar inventario", cerrar no bastaba: el
   * panel se quedaba en esa sección y el botón parecía no hacer nada (H47, prueba del 30-sep).
   * Sin esta prop el botón sólo cierra, como antes.
   */
  onVerInventario?: () => void;
}

type CatalogOption = {
  id: number;
  nombre: string;
  motor?: string;
};

type MotorOption = {
  id: string;
  etiqueta: string;
};

type PickerOption = string | { label: string; value: string };

type CompatibilityCard = {
  id: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleYearTo: number;
  motor?: string;
  motorOptions?: MotorOption[];
  vehicleVersionIds: string[];
  oem: string;
  modelOptions: string[];
  versionOptions: CatalogOption[];
  /** "Año hasta" se corrigió solo: se dice al lado del campo, no en silencio. */
  yearNote?: string;
  /**
   * Fase 7: al editar, el detalle de estos vehículos no se pudo cargar del catálogo. Los ids se
   * conservan tal cual (antes la tarjeta se borraba en silencio y al guardar se perdían).
   */
  savedWithoutDetail?: boolean;
  /**
   * El grupo tal como estaba en `compatibilityGroupsJson`. Si el detalle no llegó, se vuelve a
   * guardar esto y no lo que muestra la tarjeta (que es la marca y el modelo del producto).
   */
  savedGroup?: SavedGroup | null;
};

/** Un grupo de `compatibilityGroupsJson` como lo guardó el formulario. */
type SavedGroup = {
  vehiculoCatalogoIds: number[];
  compatBrand?: unknown;
  model?: unknown;
  yearFrom?: unknown;
  yearTo?: unknown;
  oemReference?: unknown;
  versionLabels?: unknown;
};

type VehicleCatalogDetail = {
  id: number;
  marca: string;
  modelo: string;
  anioDesde?: number;
  anioHasta?: number;
  version?: string;
  motor?: string;
  transmision?: string;
};

const OTHER_VALUE = '__other__';
const BRAND_NOT_FOUND = '__no_encuentro__';
const REQUIRED = <span style={{ color: 'hsl(var(--danger))', fontWeight: 700, marginLeft: '3px' }}>*</span>;
const OPTIONAL = (
  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>
    (opcional)
  </span>
);
/** Fotos hasta 5 MB: al guardar se comprimen solas (db.ts -> comprimirImagenes). */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_DESCRIPTION = 15;
const YEARS = Array.from(
  { length: new Date().getFullYear() + 3 - 1990 },
  (_, index) => new Date().getFullYear() + 2 - index,
);

/**
 * Deduplica las categorias que llegan del catalogo, ignorando acentos para la clave.
 *
 * Antes tambien reescribia nombres a una lista propia del panel ("Suspension y Direccion",
 * "Filtros y Mantenimiento"...). Esos nombres no existen en la taxonomia canonica de 24
 * categorias del backend, asi que el mapeo quedo obsoleto al eliminar CATEGORIES_FALLBACK.
 */
function deduplicateAndSortCategories(rawCategories: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of rawCategories) {
    if (!raw) continue;
    const cleaned = raw.trim();
    const key = cleaned.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!map.has(key)) {
      map.set(key, cleaned);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'es'));
}

const PART_BRANDS_FALLBACK = [
  'Bosch',
  'NGK',
  'TRW',
  'Monroe',
  'Varta',
  'SKF',
  'Gates',
  'Febi',
  'Mann-Filter',
  'Brembo',
  'Sachs',
  'Valeo',
  'Delphi',
  'Denso',
  'Hella',
  'Continental',
  'Goodyear',
  'ACDelco',
];

const VEHICLE_BRANDS_FALLBACK = [
  'Toyota',
  'Hyundai',
  'Kia',
  'Nissan',
  'Chevrolet',
  'Ford',
  'Honda',
  'Mazda',
  'Mitsubishi',
  'Volkswagen',
  'Mercedes-Benz',
  'BMW',
];

const MODELS_FALLBACK: Record<string, string[]> = {
  Toyota: ['Corolla', 'Hilux', 'RAV4', 'Yaris'],
  Hyundai: ['Accent', 'Elantra', 'Tucson', 'Santa Fe'],
  Kia: ['Rio', 'Sportage', 'Sorento', 'Cerato'],
  Nissan: ['Versa', 'Sentra', 'Frontier', 'X-Trail'],
  Chevrolet: ['Spark', 'Sail', 'Tracker', 'Colorado'],
  Ford: ['Ranger', 'Escape', 'Explorer', 'F-150'],
  Honda: ['Civic', 'CR-V', 'HR-V', 'Accord'],
  Mazda: ['Mazda 2', 'Mazda 3', 'CX-5', 'BT-50'],
  Mitsubishi: ['L200', 'Outlander', 'Montero', 'ASX'],
  Volkswagen: ['Gol', 'Jetta', 'Tiguan', 'Amarok'],
  'Mercedes-Benz': ['Clase C', 'Sprinter', 'GLC', 'Clase E'],
  BMW: ['Serie 3', 'X1', 'X3', 'Serie 5'],
};

const MAX_PHOTOS = 4;

const CATALOG_ERROR_MESSAGE =
  'No pudimos cargar las categorías del sistema. Revisa tu conexión y vuelve a abrir el formulario.';

// Estas dos llamadas van por apiFetch y no por fetch() crudo para heredar el timeout de la
// API (SEC-MARKET-A30/A31): sin el, un backend que acepta la conexion y nunca responde dejaba
// el desplegable de catalogo cargando sin final. El endpoint es publico, asi que no llevan
// Authorization; lo que se hereda es el limite de tiempo y el manejo comun de sesion.
async function loadCatalog(path: string): Promise<CatalogOption[]> {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/catalogos/inventario/${path}`);
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function loadVehicleCatalogDetails(ids: number[]): Promise<VehicleCatalogDetail[]> {
  if (ids.length === 0) return [];
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/catalogos/inventario/vehiculo-catalogos?ids=${ids.join(',')}`);
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

function namesFromCatalog(options: CatalogOption[], fallback: string[]) {
  return options.length > 0 ? options.map((option) => option.nombre) : fallback;
}

function splitValues(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinValues(values: string[]) {
  return values.join(', ');
}

function createCompatibilityCard(product?: Product | null): CompatibilityCard {
  return {
    id: Math.random().toString(36).slice(2, 9),
    vehicleBrand: product?.vehicleBrand || '',
    vehicleModel: product?.vehicleModel || '',
    vehicleYear: product?.vehicleYear || 0,
    vehicleYearTo: product?.vehicleYearTo || product?.vehicleYear || 0,
    motor: product?.vehicleVersion || '',
    motorOptions: [],
    vehicleVersionIds: [],
    oem: product?.oem || '',
    modelOptions: [],
    versionOptions: [],
  };
}

function vehicleDetailLabel(detail: VehicleCatalogDetail) {
  const parts = [detail.version, detail.motor, detail.transmision]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : 'Motor Indefinido';
}

function parseCompatibilityGroups(product: Product): SavedGroup[] {
  if (product.compatibilityGroupsJson) {
    try {
      const parsed = JSON.parse(product.compatibilityGroupsJson);
      if (Array.isArray(parsed)) {
        const groups = parsed
          .map((group) => {
            const ids = Array.isArray(group?.vehiculoCatalogoIds) ? group.vehiculoCatalogoIds : [];
            return {
              ...(group && typeof group === 'object' ? group : {}),
              vehiculoCatalogoIds: ids.map((id: unknown) => Number(id)).filter((id: number) => !Number.isNaN(id)),
            } as SavedGroup;
          })
          .filter((group) => group.vehiculoCatalogoIds.length > 0);
        if (groups.length > 0) return groups;
      }
    } catch {
      // Continue with flat ids fallback.
    }
  }

  return product.vehiculoCatalogoIds && product.vehiculoCatalogoIds.length > 0
    ? [{ vehiculoCatalogoIds: product.vehiculoCatalogoIds }]
    : [];
}

/** Etiqueta de un vehículo guardado cuyo detalle no llegó del catálogo. */
const savedVehicleLabel = (id: number) => `Vehículo guardado (n.º ${id})`;

/** Esa etiqueta sólo se muestra: no es una versión y no se guarda como motor ni como versión. */
const isSavedVehicleLabel = (text: string) => /^Vehículo guardado \(n\.º \d+\)$/.test(text.trim());

const withoutSavedLabels = (values: string[]) => values.filter((value) => !isSavedVehicleLabel(value));

const textOf = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

/**
 * Fase 7: el grupo de un producto que se edita, aunque `/vehiculo-catalogos` no responda o no
 * traiga todos los ids. Los que faltan se conservan con una etiqueta genérica: guardar sólo el
 * precio no puede cambiar con qué autos es compatible el repuesto.
 */
function cardForSavedGroup(group: SavedGroup, details: VehicleCatalogDetail[], product: Product): CompatibilityCard {
  const ids = group.vehiculoCatalogoIds;
  if (details.length === 0) {
    return {
      ...createCompatibilityCard(product),
      oem: '',
      vehicleVersionIds: ids.map(String),
      versionOptions: ids.map((id) => ({ id, nombre: savedVehicleLabel(id) })),
      savedWithoutDetail: true,
      // Sin grupo guardado (sólo ids sueltos) no hay marca ni modelo por grupo que devolver.
      savedGroup: 'compatBrand' in group || 'model' in group ? group : null,
    };
  }
  const card = { ...createCompatibilityCardFromDetails(details, product), oem: '' };
  const found = new Set(details.map((detail) => detail.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length === 0) return card;
  return {
    ...card,
    vehicleVersionIds: [...card.vehicleVersionIds, ...missing.map(String)],
    versionOptions: [...card.versionOptions, ...missing.map((id) => ({ id, nombre: savedVehicleLabel(id) }))],
  };
}

function createCompatibilityCardFromDetails(details: VehicleCatalogDetail[], product: Product): CompatibilityCard {
  const fallback = createCompatibilityCard(product);
  if (details.length === 0) return fallback;

  const models = Array.from(new Set(details.map((detail) => detail.modelo).filter(Boolean)));
  const yearsFrom = details.map((detail) => detail.anioDesde).filter((year): year is number => typeof year === 'number');
  const yearsTo = details
    .map((detail) => detail.anioHasta ?? detail.anioDesde)
    .filter((year): year is number => typeof year === 'number');

  return {
    ...fallback,
    vehicleBrand: details[0].marca || fallback.vehicleBrand,
    vehicleModel: joinValues(models),
    vehicleYear: yearsFrom.length > 0 ? Math.min(...yearsFrom) : fallback.vehicleYear,
    vehicleYearTo: yearsTo.length > 0 ? Math.max(...yearsTo) : fallback.vehicleYearTo,
    vehicleVersionIds: details.map((detail) => String(detail.id)),
    modelOptions: models,
    versionOptions: details.map((detail) => ({ id: detail.id, nombre: vehicleDetailLabel(detail) })),
  };
}

type SnapshotFields = {
  sku: string;
  oem: string;
  name: string;
  category: string;
  subcategory: string;
  partBrand: string;
  pricingMode: string;
  price: number;
  stock: number;
  requiresChassis: string;
  condition: string;
  description: string;
  isUniversal: boolean;
  compatibilities: CompatibilityCard[];
  filesCount: number;
  /** Fotos ya publicadas que siguen en el formulario: quitar una también es un cambio. */
  publishedCount: number;
};

/**
 * Foto del formulario para saber si hay cambios sin guardar. Fase 7: una sola función para el
 * estado inicial y el actual; antes el de edición no llevaba la subcategoría y el formulario
 * pedía "¿Descartar cambios?" aunque no se hubiera tocado nada.
 */
function snapshotOf(fields: SnapshotFields): string {
  // Campo por campo y siempre en el mismo orden: se compara el texto, y con `...fields` el orden
  // dependía de cómo se armó el objeto (el de edición y el actual no coincidían), así que al
  // cerrar sin tocar nada siempre preguntaba "¿Descartar cambios no guardados?".
  return JSON.stringify({
    sku: fields.sku.trim(),
    oem: fields.oem.trim(),
    name: fields.name.trim(),
    category: fields.category,
    subcategory: fields.subcategory,
    partBrand: fields.partBrand.trim(),
    pricingMode: fields.pricingMode,
    price: fields.price,
    stock: fields.stock,
    requiresChassis: fields.requiresChassis,
    condition: fields.condition,
    description: fields.description.trim(),
    isUniversal: fields.isUniversal,
    filesCount: fields.filesCount,
    publishedCount: fields.publishedCount,
    compatibilities: fields.compatibilities.map((card) => ({
      b: card.vehicleBrand,
      m: card.vehicleModel,
      y: card.vehicleYear,
      yt: card.vehicleYearTo,
      v: card.vehicleVersionIds,
      o: card.oem,
    })),
  });
}

const SECTION_TITLES: Record<number, string> = {
  1: 'Información básica',
  2: 'Precio y disponibilidad',
  3: 'Compatibilidad',
  5: 'Descripción y calidad',
};

/** Lo que le falta a una tarjeta de vehículo. Con versiones elegidas (o guardadas) no falta nada. */
function missingInCard(card: CompatibilityCard): string[] {
  if (card.vehicleVersionIds.length > 0) return [];
  if (!card.vehicleBrand.trim()) return ['marca del vehículo'];
  if (!card.vehicleModel.trim()) return ['modelo'];
  if (!(card.vehicleYear > 0 && card.vehicleYearTo > 0)) return ['años'];
  return ['versión'];
}

const cardHasData = (card: CompatibilityCard) =>
  Boolean(card.vehicleBrand.trim() || card.vehicleModel.trim() || card.vehicleYear > 0 || card.vehicleVersionIds.length > 0);

function SectionStatus({ missing, visited }: { missing: string[]; visited: boolean }) {
  if (missing.length === 0) {
    return <span className="manual-section-status ok"><Check size={15} /> Listo</span>;
  }
  return (
    <span className={`manual-section-status ${visited ? 'missing' : 'pending'}`}>
      {missing.length === 1 ? 'Falta 1 dato' : `Faltan ${missing.length} datos`}
    </span>
  );
}

function formatCLP(value: number) {
  return new Intl.NumberFormat('es-CL').format(value);
}

const FLOW_RATE_LABEL = `${(FLOW_RATE_BASE * 100).toFixed(2).replace('.', ',')}%`;

/**
 * Lista con "Otro" para escribir. Fase 7: lo escrito se compara con la lista sin mayúsculas,
 * tildes ni separadores, y si ya existe se usa el nombre de la lista ("bosch" -> "Bosch"): así
 * no se crean "Bosch" y "BOSCH" como dos marcas. `allowOther={false}` deja sólo la lista, para
 * catálogos cerrados como la categoría, donde un valor escrito a mano no se puede publicar.
 */
function SelectOrInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  required,
  disabled,
  allowOther = true,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  className: string;
  required?: boolean;
  disabled?: boolean;
  allowOther?: boolean;
  ariaLabel?: string;
}) {
  const [isOther, setIsOther] = useState(false);
  const uniqueOptions = nombresUnicosOrdenados(options.filter(Boolean));
  const match = value ? uniqueOptions.find((option) => claveCatalogo(option) === claveCatalogo(value)) : undefined;
  const hasValue = match === value && Boolean(value);
  const selectValue = isOther || (value && !hasValue) ? OTHER_VALUE : value;

  useEffect(() => {
    // Lo escrito que ya existe en la lista toma el nombre de la lista ("bosch" -> "Bosch") y
    // vuelve al desplegable. Reviewed, deliberate exception (QA-SRC-002).
    if (match && match !== value) {
      onChange(match);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasValue) setIsOther(false);
  }, [match, value, hasValue, onChange]);

  return (
    <>
      <select
        className={className}
        value={allowOther ? selectValue : value}
        aria-label={ariaLabel}
        onChange={(e) => {
          if (e.target.value === OTHER_VALUE) {
            setIsOther(true);
            onChange('');
            return;
          }
          setIsOther(false);
          onChange(e.target.value);
        }}
        required={required && !isOther}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {uniqueOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {!allowOther && value && !hasValue && <option value={value}>{value}</option>}
        {allowOther && <option value={OTHER_VALUE}>Otra (escribirla)</option>}
      </select>

      {allowOther && (isOther || (value && !hasValue)) && (
        <input
          type="text"
          className={className}
          placeholder="Escribe el nombre"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          style={{ marginTop: '0.5rem' }}
        />
      )}
    </>
  );
}

/**
 * Marca del vehículo: sólo las del catálogo. Fase 7: antes tenía "Otro", y una marca escrita a
 * mano no tiene modelos, así que el formulario quedaba sin salida. Ahora "No encuentro la marca"
 * ofrece las dos salidas reales: publicarlo como universal o avisar a RepuesTop.
 */
function VehicleBrandSelect({
  value,
  brands,
  onChange,
  onMakeUniversal,
}: {
  value: string;
  brands: string[];
  onChange: (value: string) => void;
  onMakeUniversal: () => void;
}) {
  const [notFound, setNotFound] = useState(false);
  const [missingBrand, setMissingBrand] = useState('');
  const [copied, setCopied] = useState(false);
  // Un producto guardado con un nombre de antes ("KIA MOTORS") se muestra con el del catálogo.
  const shown = brands.find((brand) => mismoNombreCatalogo(brand, value)) ?? value;
  const options = shown && !brands.includes(shown) ? [shown, ...brands] : brands;
  const message = `Hola, quiero publicar un repuesto para la marca de vehículo "${missingBrand.trim() || '(escribe la marca)'}" y no aparece en la lista del panel. ¿La pueden agregar?`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <select
        className="form-control focus-accent"
        aria-label="Marca del vehículo"
        value={notFound ? BRAND_NOT_FOUND : shown}
        onChange={(e) => {
          if (e.target.value === BRAND_NOT_FOUND) {
            setNotFound(true);
            onChange('');
            return;
          }
          setNotFound(false);
          onChange(e.target.value);
        }}
      >
        <option value="">Selecciona una marca</option>
        {options.map((brand) => (
          <option key={brand} value={brand}>{brand}</option>
        ))}
        <option value={BRAND_NOT_FOUND}>No encuentro la marca</option>
      </select>
      {notFound && (
        <div className="manual-inline-help" role="status">
          <strong>¿No está la marca?</strong>
          <p>Si este repuesto le sirve a cualquier vehículo, publícalo como universal. Si es para una marca que falta, avísanos y la agregamos.</p>
          <button type="button" className="btn btn-primary" onClick={onMakeUniversal}>
            <Globe size={16} /> Sirve para todos los vehículos
          </button>
          <label className="form-label" style={{ marginTop: '0.75rem' }}>
            ¿Qué marca buscabas?
            <input
              type="text"
              className="form-control focus-accent"
              value={missingBrand}
              onChange={(e) => { setMissingBrand(e.target.value); setCopied(false); }}
              placeholder="Ej. Jetour"
            />
          </label>
          <button type="button" className="btn btn-secondary" onClick={copy}>
            <Copy size={16} /> {copied ? 'Mensaje copiado' : 'Copiar mensaje para RepuesTop'}
          </button>
          {copied && <p>Pégalo en un correo o WhatsApp a RepuesTop.</p>}
        </div>
      )}
    </>
  );
}

function MultiOptionPicker({
  values,
  onChange,
  options,
  placeholder,
  emptyText,
  disabled,
  showSelectAll,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: PickerOption[];
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
  showSelectAll?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const uniqueOptions = Array.from(
    new Map(
      options
        .map((option) => (typeof option === 'string' ? { label: option, value: option } : option))
        .filter((option) => option.label && option.value)
        .map((option) => [option.value, option]),
    ).values(),
  );
  const selectedOptions = uniqueOptions.filter((option) => values.includes(option.value));

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (disabled || uniqueOptions.length === 0) {
    return <div className="manual-helper-text">{emptyText}</div>;
  }

  const toggleValue = (option: string) => {
    if (values.includes(option)) {
      onChange(values.filter((value) => value !== option));
      return;
    }
    onChange([...values, option]);
  };

  return (
    <div className="manual-multi-select" ref={pickerRef}>
      <button
        type="button"
        className={`manual-multi-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selectedOptions.length ? joinValues(selectedOptions.map((option) => option.label)) : placeholder}</span>
        <ChevronDown size={16} />
      </button>

      {isOpen && (
        <div className="manual-multi-menu">
          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
            {showSelectAll && (
              <button
                type="button"
                className="manual-select-all"
                style={{ flex: 1, margin: 0 }}
                onClick={() => onChange(uniqueOptions.map((option) => option.value))}
              >
                Seleccionar todo
              </button>
            )}
            {selectedOptions.length > 0 && (
              <button
                type="button"
                className="manual-select-all"
                style={{ flex: 1, margin: 0, background: '#f1f5f9', color: '#64748b' }}
                onClick={() => onChange([])}
              >
                Limpiar
              </button>
            )}
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
            {uniqueOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`manual-option-row ${values.includes(option.value) ? 'active' : ''}`}
                onClick={() => toggleValue(option.value)}
              >
                <span>{option.label}</span>
                {values.includes(option.value) && <Check size={16} />}
              </button>
            ))}
          </div>

          <div className="manual-multi-actions">
            <button
              type="button"
              className="manual-multi-confirm"
              onClick={() => setIsOpen(false)}
            >
              <Check size={14} />
              Aceptar {selectedOptions.length > 0 ? `(${selectedOptions.length})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const ManualUpload: React.FC<ManualUploadProps> = ({
  isOpen,
  onClose,
  onSave,
  editProduct,
  founder = false,
  onVerInventario,
}) => {
  const [sku, setSku] = useState('');
  const [oem, setOem] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [partBrand, setPartBrand] = useState('');
  const [compatibilities, setCompatibilities] = useState<CompatibilityCard[]>(() => [createCompatibilityCard()]);
  // Compatibilidad universal: el repuesto es compatible con cualquier vehiculo. Al activarlo
  // se oculta y omite el detalle de compatibilidad (mismo comportamiento que el formulario mobile).
  const [isUniversal, setIsUniversal] = useState(false);
  const [pricingMode, setPricingMode] = useState<'show_price' | 'quote_only'>('show_price');
  const [price, setPrice] = useState<number>(0);
  const [stock, setStock] = useState<number>(1);
  const [requiresChassis, setRequiresChassis] = useState<'false' | 'true'>('false');
  const [condition, setCondition] = useState<'ORIGINAL' | 'ALTERNATIVO'>('ORIGINAL');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [catalogCategoriesRaw, setCatalogCategoriesRaw] = useState<CatalogOption[]>([]);
  const [catalogSubcategories, setCatalogSubcategories] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogPartBrands, setCatalogPartBrands] = useState<string[]>(PART_BRANDS_FALLBACK);
  const [vehicleBrandCatalog, setVehicleBrandCatalog] = useState<CatalogOption[]>([]);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [showPricingDetails, setShowPricingDetails] = useState(false);
  // Fase 7: secciones que el vendedor ya recorrió (ahí se dice qué falta) y el producto recién
  // guardado, para confirmarlo en pantalla en vez de cerrar el formulario sin decir nada.
  const [visitedSections, setVisitedSections] = useState<Set<number>>(() => new Set());
  const [savedResult, setSavedResult] = useState<{ name: string; edited: boolean } | null>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const initialSnapshotRef = useRef<string | null>(null);
  // Fotos publicadas al abrir la edición: las que no caben en pantalla y cuántas eran en total.
  const hiddenPublishedRef = useRef<string[]>([]);
  const initialPublishedCountRef = useRef(0);

  const computeSnapshot = useCallback(() => snapshotOf({
    sku, oem, name, category, subcategory, partBrand, pricingMode, price, stock, requiresChassis,
    condition, description, isUniversal, compatibilities, filesCount: imageFiles.length,
    publishedCount: imagePreviews.filter((preview) => !preview.startsWith('blob:')).length,
  }), [sku, oem, name, category, subcategory, partBrand, pricingMode, price, stock, requiresChassis, condition, description, isUniversal, compatibilities, imageFiles.length, imagePreviews]);

  const resetToEmpty = useCallback(() => {
    const defaultCard = [createCompatibilityCard()];
    setSku('');
    setOem('');
    setName('');
    setCategory('');
    setSubcategory('');
    setPartBrand('');
    setCompatibilities(defaultCard);
    setPricingMode('show_price');
    setPrice(0);
    setStock(1);
    setRequiresChassis('false');
    setIsUniversal(false);
    setCondition('ORIGINAL');
    setDescription('');
    setImage('');
    setImagePreviews([]);
    setImageFiles([]);
    hiddenPublishedRef.current = [];
    initialPublishedCountRef.current = 0;
    setVisitedSections(new Set());
    setSavedResult(null);
    setError(null);
    initialSnapshotRef.current = snapshotOf({
      sku: '', oem: '', name: '', category: '', subcategory: '', partBrand: '', pricingMode: 'show_price',
      price: 0, stock: 1, requiresChassis: 'false', condition: 'ORIGINAL', description: '', isUniversal: false,
      compatibilities: defaultCard, filesCount: 0, publishedCount: 0,
    });
  }, []);

  useEffect(() => {
    return () => {
      imagePreviews.forEach((preview) => {
        if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
      });
    };
  }, [imagePreviews]);

  useEffect(() => {
    let active = true;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowUnsavedConfirm(false);

    if (editProduct) {
      // Initializes the form fields from the product being edited. Multiple
      // synchronous setState calls here are the standard "seed form state
      // from a prop" pattern, not an accidental render loop — reviewed,
      // deliberate exception (QA-SRC-002).
      const base = {
        sku: editProduct.sku,
        oem: editProduct.oem || '',
        name: editProduct.name,
        category: editProduct.category || 'Motor',
        subcategory: editProduct.subcategory || '',
        partBrand: editProduct.partBrand,
        pricingMode: editProduct.pricingMode || 'show_price',
        price: editProduct.price,
        stock: editProduct.stock || 0,
        requiresChassis: editProduct.requiresChassis ? 'true' : 'false',
        condition: editProduct.condition || 'ORIGINAL',
        description: editProduct.description || '',
        isUniversal: editProduct.esUniversal === true,
        filesCount: 0,
        publishedCount: 0,
      };
      // Sólo las fotos reales: a un producto sin fotos el listado le rellena la imagen genérica,
      // y esa no es una foto "Publicada" del vendedor.
      const published = (
        editProduct.images && editProduct.images.length > 0
          ? editProduct.images
          : editProduct.image ? [editProduct.image] : []
      ).filter((url) => url && url !== DEFAULT_PRODUCT_IMAGE_URL);
      base.publishedCount = Math.min(published.length, MAX_PHOTOS);
      // Las que no caben en los 4 recuadros (una carga masiva admite más) se conservan siempre.
      hiddenPublishedRef.current = published.slice(MAX_PHOTOS);
      initialPublishedCountRef.current = published.length;
      setSku(base.sku);
      setOem(base.oem);
      setName(base.name);
      setCategory(base.category);
      setSubcategory(base.subcategory);
      setPartBrand(base.partBrand);
      // El OEM vive en el producto; la tarjeta queda para una referencia propia de ese vehículo.
      const initialCards = [{ ...createCompatibilityCard(editProduct), oem: '' }];
      setCompatibilities(initialCards);
      const groups = parseCompatibilityGroups(editProduct);
      if (groups.length > 0) {
        Promise.all(groups.map((group) => loadVehicleCatalogDetails(group.vehiculoCatalogoIds))).then((detailGroups) => {
          if (!active) return;
          const restoredCards = detailGroups.map((details, index) => cardForSavedGroup(groups[index], details, editProduct));
          setCompatibilities(restoredCards);
          initialSnapshotRef.current = snapshotOf({ ...base, compatibilities: restoredCards });
        });
      }
      setPricingMode(base.pricingMode);
      setPrice(base.price);
      setStock(base.stock);
      setRequiresChassis(base.requiresChassis as 'false' | 'true');
      setIsUniversal(base.isUniversal);
      setCondition(base.condition);
      setDescription(base.description);
      setImage(published[0] || '');
      // Fase 7: todas las fotos publicadas, no sólo la primera.
      setImagePreviews(published.slice(0, MAX_PHOTOS));
      setImageFiles([]);
      setVisitedSections(new Set());
      setSavedResult(null);
      initialSnapshotRef.current = snapshotOf({ ...base, compatibilities: initialCards });
    } else {
      resetToEmpty();
    }
    setError(null);

    return () => {
      active = false;
    };
  }, [editProduct, isOpen, resetToEmpty]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    Promise.all([
      loadCatalog('categorias-repuesto'),
      loadCatalog('marcas-vehiculo'),
    ]).then(([categories, vehicleBrands]) => {
      if (!active) return;
      // Al quitar la lista de categorias hardcodeada, el catalogo remoto pasa a ser
      // obligatorio. Sin este aviso, un fallo de red dejaba el desplegable vacio y el
      // vendedor no podia publicar sin entender por que.
      setCatalogError(categories.length === 0 ? CATALOG_ERROR_MESSAGE : null);
      setCatalogCategoriesRaw(categories);
      setCatalogCategories(deduplicateAndSortCategories(namesFromCatalog(categories, [])));
      setVehicleBrandCatalog(vehicleBrands);
    }).catch(() => {
      if (!active) return;
      setCatalogError(CATALOG_ERROR_MESSAGE);
    });

    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !category) return;
    let active = true;

    loadCatalog(`marcas-repuesto?categoria=${encodeURIComponent(category)}`).then((brands) => {
      if (active) setCatalogPartBrands(namesFromCatalog(brands, PART_BRANDS_FALLBACK));
    });

    return () => {
      active = false;
    };
  }, [category, isOpen]);

  useEffect(() => {
    // La subcategoria es una taxonomia cerrada por categoria (el backend descarta en
    // silencio -- con una advertencia -- cualquier subcategoria que no pertenezca a la
    // categoria elegida), asi que el desplegable se resuelve por id via
    // /categorias-repuesto/{id}/subcategorias en vez de dejar texto libre como en marca.
    if (!isOpen || !category) {
      setCatalogSubcategories([]);
      return;
    }
    const normalized = category.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const foundCategory = catalogCategoriesRaw.find(
      (option) => option.nombre.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized,
    );
    if (!foundCategory) {
      setCatalogSubcategories([]);
      return;
    }
    let active = true;

    loadCatalog(`categorias-repuesto/${foundCategory.id}/subcategorias`).then((subcategories) => {
      if (active) setCatalogSubcategories(namesFromCatalog(subcategories, []));
    });

    return () => {
      active = false;
    };
  }, [category, isOpen, catalogCategoriesRaw]);

  const compatibilityCatalogKey = compatibilities
    .map((card) => `${card.id}|${card.vehicleBrand}|${card.vehicleModel}|${card.vehicleYear}|${card.vehicleYearTo}`)
    .join(';');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    Promise.all(
      compatibilities.map(async (card) => {
        if (card.savedWithoutDetail) {
          return { id: card.id, modelOptions: card.modelOptions, versionOptions: card.versionOptions, motorOptions: card.motorOptions || [] };
        }
        if (!card.vehicleBrand) {
          return { id: card.id, modelOptions: [], versionOptions: [], motorOptions: [] };
        }

        // Fase 5: la marca guardada puede venir escrita como antes ("KIA MOTORS", "MERCEDES BENZ").
        const selectedBrand = vehicleBrandCatalog.find((brand) => mismoNombreCatalogo(brand.nombre, card.vehicleBrand));
        const marcaCatalogo = selectedBrand?.nombre ?? card.vehicleBrand;
        const models = nombresUnicosOrdenados(
          selectedBrand
            ? namesFromCatalog(await loadCatalog(`marcas-vehiculo/${selectedBrand.id}/modelos`), MODELS_FALLBACK[card.vehicleBrand] || [])
            : MODELS_FALLBACK[card.vehicleBrand] || [],
        );

        const selectedModels = splitValues(card.vehicleModel);
        if (selectedModels.length === 0) {
          return { id: card.id, modelOptions: models, versionOptions: [], motorOptions: [] };
        }

        const versionGroups = await Promise.all(
          selectedModels.map((model) =>
            loadCatalog(`versiones?marca=${encodeURIComponent(marcaCatalogo)}&modelo=${encodeURIComponent(model)}&anioDesde=${card.vehicleYear}&anioHasta=${card.vehicleYearTo}`),
          ),
        );
        const versionOptions = Array.from(
          new Map(versionGroups.flat().map((version) => [String(version.id), version])).values(),
        );

        const motorGroups = await Promise.all(
          selectedModels.map(async (model) => {
            const params = new URLSearchParams({ marca: marcaCatalogo, modelo: model });
            if (card.vehicleYear) params.set('anioDesde', String(card.vehicleYear));
            if (card.vehicleYearTo) params.set('anioHasta', String(card.vehicleYearTo));
            try {
              const res = await apiFetch(`${API_BASE_URL}/api/v1/catalogos/inventario/motores?${params.toString()}`);
              if (!res.ok) return [];
              return (await res.json()) as MotorOption[];
            } catch {
              return [];
            }
          }),
        );
        let motorOptions = Array.from(
          new Map(motorGroups.flat().map((m) => [m.id, m])).values(),
        );
        if (motorOptions.length === 0 && versionOptions.length > 0) {
          const distinctMotors = Array.from(
            new Set(
              versionOptions
                .map((v) => v.motor)
                .filter((m): m is string => Boolean(m && String(m).trim())),
            ),
          );
          motorOptions = distinctMotors.map((m) => ({ id: m, etiqueta: formatearEtiquetaMotor(m) }));
        }

        return { id: card.id, modelOptions: models, versionOptions, motorOptions };
      }),
    ).then((results) => {
      if (!active) return;
      setCompatibilities((current) =>
        current.map((card) => {
          const result = results.find((item) => item.id === card.id);
          if (!result) return card;
          // Fase 7: las versiones ya elegidas no se descartan si /versiones no las devuelve (el
          // catálogo cambió o la llamada falló). Cambiar modelo o años ya las limpia a propósito
          // en updateCompatibility; aquí sólo se completan las opciones.
          const validVersionIds = new Set(result.versionOptions.map((version) => String(version.id)));
          const kept = card.versionOptions.filter(
            (version) => card.vehicleVersionIds.includes(String(version.id)) && !validVersionIds.has(String(version.id)),
          );
          const missing = card.vehicleVersionIds
            .filter((id) => !validVersionIds.has(id) && !kept.some((version) => String(version.id) === id))
            .map((id) => ({ id: Number(id), nombre: savedVehicleLabel(Number(id)) }));
          return {
            ...card,
            modelOptions: result.modelOptions,
            versionOptions: [...result.versionOptions, ...kept, ...missing],
            motorOptions: result.motorOptions || [],
          };
        }),
      );
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, vehicleBrandCatalog, compatibilityCatalogKey]);

  const dialogRef = useFocusTrap(isOpen);
  const bodyRef = useRef<HTMLDivElement>(null);

  const triggerError = (msg: string) => {
    setError(msg);
    setSaving(false);
    if (bodyRef.current) {
      bodyRef.current.scrollTo?.({ top: 0, behavior: 'smooth' });
    }
  };

  const handleFormInvalid = (e: React.FormEvent<HTMLFormElement>) => {
    const target = e.target as HTMLElement;
    if (target) {
      target.focus();
      if (target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const formGroup = target.closest('.form-group');
      const labelText = formGroup?.querySelector('.form-label')?.textContent || '';
      const cleanLabel = labelText
        .replace('*', '')
        .replace('(Obligatorio)', '')
        .replace('(Opcional)', '')
        .trim();
      triggerError(`Falta completar el campo obligatorio: "${cleanLabel || 'Requerido'}".`);
    }
  };

  const isFormDirty = useCallback(() => {
    if (!initialSnapshotRef.current) return false;
    return computeSnapshot() !== initialSnapshotRef.current;
  }, [computeSnapshot]);

  const attemptClose = useCallback(() => {
    if (saving) return;
    if (isFormDirty()) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  }, [saving, isFormDirty, onClose]);

  const handleForceClose = () => {
    setShowUnsavedConfirm(false);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showUnsavedConfirm) {
          setShowUnsavedConfirm(false);
        } else {
          attemptClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showUnsavedConfirm, attemptClose]);

  if (!isOpen) return null;

  const missingBySection: Record<number, string[]> = {
    1: [
      !name.trim() && 'nombre',
      !category.trim() && 'categoría',
      !partBrand.trim() && 'marca del repuesto',
      !sku.trim() && 'código (SKU)',
    ].filter((item): item is string => Boolean(item)),
    2: pricingMode === 'show_price' && price <= 0 ? ['precio'] : [],
    3: isUniversal
      ? []
      : compatibilities.flatMap((card, index) =>
        index === 0 || cardHasData(card)
          ? missingInCard(card).map((item) => (compatibilities.length > 1 ? `${item} (vehículo ${index + 1})` : item))
          : [],
      ),
    5: description.trim().length < MIN_DESCRIPTION ? [`descripción (mínimo ${MIN_DESCRIPTION} letras)`] : [],
  };

  const markVisited = (section: number) => (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setVisitedSections((current) => (current.has(section) ? current : new Set(current).add(section)));
  };

  const missingNote = (section: number) =>
    visitedSections.has(section) && missingBySection[section].length > 0 ? (
      <p className="manual-section-missing" role="status">Falta: {missingBySection[section].join(', ')}.</p>
    ) : null;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (newFiles.length === 0) return;

    const currentCount = imagePreviews.length;
    const availableSlots = MAX_PHOTOS - currentCount;

    if (availableSlots <= 0) {
      triggerError('Ya has cargado el máximo de 4 fotos por producto.');
      return;
    }

    if (newFiles.length > availableSlots) {
      setError(`Solo puedes agregar ${availableSlots} foto(s) más (máximo 4 por producto).`);
    }

    const filesToAdd = newFiles.slice(0, availableSlots);
    const oversized = filesToAdd.find((file) => file.size > MAX_PHOTO_BYTES);
    if (oversized) {
      triggerError(`La foto "${oversized.name}" pesa más de 5 MB. Elige una más liviana.`);
      return;
    }

    setError(null);
    setImage('');
    const newPreviews = filesToAdd.map((file) => URL.createObjectURL(file));
    setImageFiles((prev) => [...prev, ...filesToAdd]);
    setImagePreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeImageAt = (index: number) => {
    const preview = imagePreviews[index];
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    setImagePreviews((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (preview === image) setImage('');
    if (preview?.startsWith('blob:')) {
      const blobIndex = imagePreviews.slice(0, index).filter((item) => item.startsWith('blob:')).length;
      setImageFiles((current) => current.filter((_, itemIndex) => itemIndex !== blobIndex));
    }
  };

  const updateCompatibility = (id: string, fields: Partial<CompatibilityCard>) => {
    setCompatibilities((current) =>
      current.map((card) => {
        if (card.id !== id) return card;
        const next = { ...card, ...fields };
        if (fields.vehicleBrand !== undefined) {
          next.vehicleModel = '';
          next.vehicleVersionIds = [];
          next.modelOptions = [];
          next.versionOptions = [];
          next.motor = '';
          next.motorOptions = [];
        }
        if (fields.vehicleModel !== undefined || fields.vehicleYear !== undefined || fields.vehicleYearTo !== undefined) {
          next.vehicleVersionIds = [];
          next.versionOptions = [];
          next.motor = '';
          next.savedWithoutDetail = false;
        }
        if (fields.vehicleYearTo !== undefined || fields.vehicleBrand !== undefined) {
          next.yearNote = undefined;
        }
        if (fields.vehicleYear !== undefined && fields.vehicleYear > 0) {
          next.yearNote = undefined;
          if (next.vehicleYearTo && next.vehicleYearTo < fields.vehicleYear) {
            next.yearNote = `Cambiamos "Año hasta" a ${fields.vehicleYear} para que no quede antes de "Año desde".`;
          }
          if (!next.vehicleYearTo || next.vehicleYearTo < fields.vehicleYear) {
            next.vehicleYearTo = fields.vehicleYear;
          }
        }
        if (next.vehicleYearTo > 0 && next.vehicleYear > 0 && next.vehicleYearTo < next.vehicleYear) {
          next.vehicleYearTo = next.vehicleYear;
        }
        return next;
      }),
    );
  };

  const addCompatibility = () => {
    setCompatibilities((current) => [...current, createCompatibilityCard()]);
  };

  const removeCompatibility = (id: string) => {
    setCompatibilities((current) => (current.length <= 1 ? current : current.filter((card) => card.id !== id)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    // Fase 7: una sola regla para las insignias de cada sección y para el botón de guardar.
    const firstIncomplete = [1, 2, 3, 5].find((section) => missingBySection[section].length > 0);
    if (firstIncomplete !== undefined) {
      setVisitedSections(new Set([1, 2, 3, 5]));
      triggerError(`Faltan datos en "${SECTION_TITLES[firstIncomplete]}": ${missingBySection[firstIncomplete].join(', ')}.`);
      sectionRefs.current[firstIncomplete]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return;
    }

    try {
      const primaryCompatibility = compatibilities[0] || createCompatibilityCard();
      const compatibilityGroups = compatibilities
        .map((card) => {
          if (card.savedWithoutDetail) {
            // El detalle no llegó: se devuelve el grupo como estaba, sin inventar marca, modelo ni
            // años a partir del producto, y sin la etiqueta "Vehículo guardado" como versión.
            const saved = card.savedGroup;
            return {
              vehiculoCatalogoIds: Array.from(new Set(card.vehicleVersionIds)).map(Number).filter((id) => !Number.isNaN(id)),
              compatBrand: textOf(saved?.compatBrand),
              model: textOf(saved?.model),
              yearFrom: textOf(saved?.yearFrom),
              yearTo: textOf(saved?.yearTo),
              oemReference: sanitizeCodeInput(card.oem) || textOf(saved?.oemReference),
              versionLabels: Array.isArray(saved?.versionLabels)
                ? withoutSavedLabels(saved.versionLabels.map(textOf))
                : [],
            };
          }
          const selectedIds = card.vehicleVersionIds.length > 0
            ? card.vehicleVersionIds
            : card.versionOptions.map((version) => String(version.id));
          const selectedVersionLabels = withoutSavedLabels(card.versionOptions
            .filter((version) => selectedIds.includes(String(version.id)))
            .map((version) => version.nombre));
          return {
            vehiculoCatalogoIds: Array.from(new Set(selectedIds)).map(Number).filter((id) => !Number.isNaN(id)),
            compatBrand: card.vehicleBrand,
            model: card.vehicleModel,
            yearFrom: String(card.vehicleYear),
            yearTo: String(card.vehicleYearTo),
            motor: card.motor || '',
            oemReference: sanitizeCodeInput(card.oem),
            versionLabels: selectedVersionLabels,
          };
        })
        .filter((group) => group.vehiculoCatalogoIds.length > 0 || group.compatBrand || group.model);
      const allCatalogIds = Array.from(
        new Set(compatibilityGroups.flatMap((group) => group.vehiculoCatalogoIds)),
      );
      const primaryVersionLabels = withoutSavedLabels(primaryCompatibility.versionOptions
        .filter((version) =>
          (primaryCompatibility.vehicleVersionIds.length > 0
            ? primaryCompatibility.vehicleVersionIds
            : primaryCompatibility.versionOptions.map((item) => String(item.id))
          ).includes(String(version.id)),
        )
        .map((version) => version.nombre));
      // Sin detalle del catálogo no hay versiones que leer: el motor queda el que ya tenía.
      const savedMotor = editProduct?.vehicleVersion || '';
      const primaryMotor = !primaryCompatibility.savedWithoutDetail
        ? (primaryCompatibility.motor || joinValues(primaryVersionLabels))
        : splitValues(savedMotor).some(isSavedVehicleLabel)
        ? joinValues(withoutSavedLabels(splitValues(savedMotor)))
        : savedMotor;

      const finalImage = editProduct && imageFiles.length === 0 && image
        ? image
        : imageFiles.length > 0
        ? ''
        : DEFAULT_PRODUCT_IMAGE_URL;

      const productPayload: Omit<Product, 'id' | 'lastUpdated'> & { id?: string } = {
        sku: sanitizeCodeInput(sku),
        // Fase 7: el OEM del producto se escribe siempre arriba; la referencia de la primera
        // tarjeta queda como respaldo (antes un universal nuevo no podía tener OEM).
        oem: sanitizeCodeInput(oem || (isUniversal ? '' : primaryCompatibility.oem)),
        name: name.trim(),
        category,
        subcategory: subcategory.trim() || undefined,
        partBrand: partBrand.trim(),
        esUniversal: isUniversal,
        vehicleBrand: isUniversal ? '' : primaryCompatibility.vehicleBrand.trim(),
        vehicleModel: isUniversal ? '' : primaryCompatibility.vehicleModel.trim(),
        vehicleYear: isUniversal ? 0 : Number(primaryCompatibility.vehicleYear),
        vehicleYearTo: isUniversal ? 0 : Number(primaryCompatibility.vehicleYearTo),
        vehicleVersion: isUniversal ? '' : primaryMotor,
        pricingMode,
        price: pricingMode === 'quote_only' ? 0 : Number(price),
        stock: Number(stock),
        requiresChassis: requiresChassis === 'true',
        condition,
        description: description.trim(),
        image: finalImage,
        vehiculoCatalogoIds: isUniversal ? [] : allCatalogIds,
        compatibilityGroupsJson: isUniversal ? '[]' : JSON.stringify(compatibilityGroups),
      };

      if (editProduct) {
        productPayload.id = editProduct.id;
        // El backend borra todas las fotos anteriores si recibe fotos nuevas sin la lista de las
        // que se quedan. Se manda la lista completa cuando se agregan fotos o se quita alguna
        // publicada (una lista vacía significa "borrar todas").
        const keptPublished = [
          ...imagePreviews.filter((preview) => !preview.startsWith('blob:')),
          ...hiddenPublishedRef.current,
        ];
        if (imageFiles.length > 0 || keptPublished.length < initialPublishedCountRef.current) {
          productPayload.existingPhotos = keptPublished;
        }
      }

      await onSave(productPayload, imageFiles.length > 0 ? imageFiles : null);
      setSavedResult({ name: productPayload.name, edited: Boolean(editProduct) });
      initialSnapshotRef.current = computeSnapshot();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar el producto.');
    } finally {
      setSaving(false);
    }
  };

  const priceFee = serviceFeeAmount(price, founder);
  const priceBreakdown = pricingFeeBreakdown(price, founder);
  const sellerEarnings = calculateSellerEarnings(price, founder);
  const suggestedPrice = calculateSuggestedPrice(price, founder);

  return (
    <div className="drawer-overlay" onClick={attemptClose}>
      <div
        className="drawer-content manual-upload-drawer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={editProduct ? 'Editar producto' : 'Crear producto'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header manual-upload-header">
          <div>
            <h3>
              <span className="manual-upload-title-dot"></span>
              {editProduct ? 'Editar producto' : 'Crear producto'}
            </h3>
            <span className="drawer-subtitle">
              {editProduct ? `SKU: ${editProduct.sku}` : 'Un repuesto a la vez'}
            </span>
          </div>
          <button type="button" className="btn-icon" onClick={attemptClose} aria-label="Cerrar formulario de producto">
            <X size={20} />
          </button>
        </div>

        {savedResult ? (
          <div className="modal-body manual-upload-body manual-success" role="status">
            <CheckCircle2 size={48} className="manual-success-icon" />
            <h4>{savedResult.edited ? 'Listo: guardaste los cambios' : 'Listo: publicaste tu repuesto'}</h4>
            <p>
              <strong>{savedResult.name}</strong>{' '}
              {savedResult.edited ? 'ya tiene los datos nuevos.' : 'ya está en tu inventario y a la vista de los compradores.'}
            </p>
            <div className="manual-success-actions">
              <button type="button" className="btn btn-primary" onClick={onVerInventario ?? onClose}>Ver en inventario</button>
              {!savedResult.edited && (
                <button type="button" className="btn btn-secondary" onClick={resetToEmpty}>Publicar otro repuesto</button>
              )}
            </div>
          </div>
        ) : (
        <form
          onSubmit={handleSubmit}
          onInvalid={handleFormInvalid}
          // Fase 7: la validación la hace el formulario por secciones (qué falta y dónde), no el
          // globo del navegador que muestra un solo campo a la vez.
          noValidate
          // Fase 7: Enter en un campo de texto no publica el repuesto a medio llenar.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
          }}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <div className="modal-body manual-upload-body" ref={bodyRef}>
            {error && (
              <div
                style={{
                  background: 'hsl(var(--danger) / 0.12)',
                  border: '1px solid hsl(var(--danger) / 0.4)',
                  borderRadius: '10px',
                  padding: '0.85rem 1.1rem',
                  fontSize: '0.85rem',
                  color: 'hsl(var(--danger))',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  marginBottom: '1.5rem',
                  fontWeight: 600
                }}
              >
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <div
              className="form-section-card manual-form-section"
              style={{ borderLeft: '4px solid hsl(var(--primary))' }}
              ref={(el) => { sectionRefs.current[1] = el; }}
              onBlur={markVisited(1)}
            >
              <div className="form-section-header primary manual-section-header-status">
                <div><span>1.</span> Información básica</div>
                <SectionStatus missing={missingBySection[1]} visited={visitedSections.has(1)} />
              </div>
              {missingNote(1)}
              <div className="form-section-grid">
                <div className="form-group form-section-grid-full">
                  <label className="form-label">Nombre del producto {REQUIRED}</label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej. Pastillas de freno delanteras"
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Categoría {REQUIRED}</label>
                  <SelectOrInput
                    className="form-control focus-primary"
                    placeholder="Selecciona una categoría"
                    value={category}
                    onChange={setCategory}
                    options={catalogCategories}
                    allowOther={false}
                    ariaLabel="Categoría"
                    required
                  />
                  {catalogError && (
                    <p role="alert" style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'hsl(var(--destructive))' }}>
                      {catalogError}
                    </p>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Subcategoría {OPTIONAL}</label>
                  <select
                    className="form-control focus-primary"
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    disabled={!category || catalogSubcategories.length === 0}
                  >
                    <option value="">
                      {!category
                        ? 'Selecciona primero una categoría'
                        : catalogSubcategories.length === 0
                        ? 'Sin subcategorías disponibles'
                        : 'Selecciona una subcategoría'}
                    </option>
                    {catalogSubcategories.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Marca del repuesto {REQUIRED}</label>
                  <SelectOrInput
                    className="form-control focus-primary"
                    placeholder="Selecciona una marca"
                    value={partBrand}
                    onChange={setPartBrand}
                    options={catalogPartBrands}
                    ariaLabel="Marca del repuesto"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Número OEM o de fábrica {OPTIONAL}</label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej. 04465-0K090"
                    value={oem}
                    onChange={(e) => setOem(sanitizeCodeInput(e.target.value))}
                  />
                  <span className="manual-field-help">El código original del repuesto. Ayuda a que te encuentren por ese número.</span>
                </div>

                <div className="form-group form-section-grid-full">
                  <label className="form-label">SKU (tu código interno) {REQUIRED}</label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej. PFD1234"
                    maxLength={30}
                    value={sku}
                    onChange={(e) => setSku(sanitizeCodeInput(e.target.value).slice(0, 30))}
                    disabled={!!editProduct}
                    required
                  />
                </div>
              </div>
            </div>

            <div
              className="form-section-card manual-form-section"
              style={{ borderLeft: '4px solid hsl(var(--success))' }}
              ref={(el) => { sectionRefs.current[2] = el; }}
              onBlur={markVisited(2)}
            >
              <div className="form-section-header success manual-section-header-status">
                <div><span>2.</span> Precio y disponibilidad</div>
                <SectionStatus missing={missingBySection[2]} visited={visitedSections.has(2)} />
              </div>
              {missingNote(2)}
              {requiresChassis === 'true' && (
                <div className="manual-inline-help">
                  <p>Como pides el número de chasis, este repuesto va <strong>a cotización</strong>: el comprador te escribe con su chasis y tú le das el precio.</p>
                  <button type="button" className="btn btn-secondary" onClick={() => setRequiresChassis('false')}>
                    No necesito el chasis
                  </button>
                </div>
              )}
              <div className="manual-radio-row">
                <button
                  type="button"
                  className={`manual-radio-card ${pricingMode === 'show_price' ? 'active' : ''}`}
                  onClick={() => setPricingMode('show_price')}
                  disabled={requiresChassis === 'true'}
                >
                  <strong>Mostrar precio</strong>
                  <span>El precio será visible para los compradores</span>
                </button>
                <button
                  type="button"
                  className={`manual-radio-card ${pricingMode === 'quote_only' ? 'active' : ''}`}
                  onClick={() => setPricingMode('quote_only')}
                >
                  <strong>Sólo cotizar</strong>
                  <span>Los compradores te pedirán una cotización</span>
                </button>
              </div>

              <div className="form-section-grid">
                <div className="form-group">
                  <label className="form-label">
                    {pricingMode === 'quote_only' ? 'Precio oculto' : 'Precio de venta'} {pricingMode === 'show_price' ? REQUIRED : OPTIONAL}
                  </label>
                  <input
                    type="number"
                    className="form-control focus-success"
                    placeholder={pricingMode === 'quote_only' ? 'No se muestra' : '0'}
                    min={0}
                    max={99999999}
                    value={pricingMode === 'quote_only' ? '' : price || ''}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Math.min(99999999, Math.max(0, Number.isNaN(raw) ? 0 : raw));
                      setPrice(clamped);
                    }}
                    disabled={pricingMode === 'quote_only'}
                    required={pricingMode === 'show_price'}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Stock disponible {REQUIRED}</label>
                  <input
                    type="number"
                    className="form-control focus-success"
                    placeholder="Ej. 1"
                    min={0}
                    max={99999}
                    value={stock}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Math.min(99999, Math.max(0, Number.isNaN(raw) ? 0 : raw));
                      setStock(clamped);
                    }}
                    required
                  />
                </div>
              </div>

              {pricingMode !== 'quote_only' && price > 0 && (
                <div className="manual-pricing-helper">
                  {founder && <div className="manual-pricing-row"><strong>Beneficio Fundador: tarifa RepuesTop fija de 5% + IVA</strong></div>}

                  <button
                    type="button"
                    onClick={() => setShowPricingDetails((prev) => !prev)}
                    className="manual-pricing-row"
                    style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                  >
                    <span style={{ color: '#0066ff', fontWeight: 600 }}>Costos totales de la venta:</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <strong className="manual-pricing-fee">-${formatCLP(priceFee)}</strong>
                      {showPricingDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>

                  <div className="manual-pricing-row">
                    <strong>Recibirás en tu cuenta (Líquido):</strong>
                    <strong className="manual-pricing-earnings">${formatCLP(sellerEarnings)}</strong>
                  </div>
                  <div className="manual-pricing-row" style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    <span>Abono estimado:</span>
                    <span>11 días tras entrega (sin reclamos)</span>
                  </div>

                  {showPricingDetails && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.6rem', backgroundColor: 'rgba(100, 116, 139, 0.08)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div className="manual-pricing-row">
                        <span>Comisión RepuesTop ({Math.round(priceBreakdown.rate * 100)}% + IVA):</span>
                        <strong className="manual-pricing-fee">-${formatCLP(priceBreakdown.repuestopWithIva)}</strong>
                      </div>
                      <div className="manual-pricing-row" style={{ paddingLeft: '0.75rem', fontSize: '0.78rem', opacity: 0.85 }}>
                        <span>↳ Neto comisión: ${formatCLP(priceBreakdown.repuestopNet)} | IVA (19%): ${formatCLP(priceBreakdown.repuestopIva)}</span>
                      </div>
                      <div className="manual-pricing-row">
                        <span>Procesamiento Flow ({FLOW_RATE_LABEL} + IVA):</span>
                        <strong className="manual-pricing-fee">-${formatCLP(priceBreakdown.flowWithIva)}</strong>
                      </div>
                    </div>
                  )}

                  {suggestedPrice > price && (
                    <div className="manual-suggested-price">
                      <div>
                        <span>Para recibir exactamente ${formatCLP(price)} liquido, te sugerimos publicar a:</span>
                        <strong>${formatCLP(suggestedPrice)}</strong>
                      </div>
                      <button type="button" onClick={() => setPrice(suggestedPrice)}>
                        Aplicar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className="form-section-card manual-form-section"
              style={{ borderLeft: '4px solid hsl(var(--accent))' }}
              ref={(el) => { sectionRefs.current[3] = el; }}
              onBlur={markVisited(3)}
            >
              <div className="form-section-header accent manual-section-header-status">
                <div><span>3.</span> Compatibilidad {REQUIRED}</div>
                <SectionStatus missing={missingBySection[3]} visited={visitedSections.has(3)} />
              </div>
              {missingNote(3)}
              <div className="manual-compat-list">
                <div className={`manual-universal-card${isUniversal ? ' is-active' : ''}`}>
                  <div className="manual-universal-title">
                    <div className="manual-universal-icon">
                      <Globe size={20} />
                    </div>
                    <strong>Compatibilidad universal</strong>
                  </div>
                  <p className="manual-universal-desc">
                    Actívalo si este repuesto es compatible con todo tipo de vehículo.
                  </p>
                  <label className="manual-universal-switch-row">
                    <input
                      type="checkbox"
                      checked={isUniversal}
                      onChange={(e) => setIsUniversal(e.target.checked)}
                      aria-label="Compatibilidad universal"
                    />
                    <span className="manual-universal-slider" />
                    <span className="manual-universal-switch-label">
                      {isUniversal ? 'Activada' : 'Desactivada'}
                    </span>
                  </label>
                  {isUniversal && (
                    <div className="manual-universal-badge">
                      <Check size={16} />
                      <span>Repuesto universal: se mostrará para cualquier modelo o patente buscada.</span>
                    </div>
                  )}
                  {isUniversal && compatibilities.some(cardHasData) && (
                    <p className="manual-field-help" role="status">
                      Los vehículos que ya elegiste siguen aquí por si lo desactivas, pero mientras sea universal no se publican.
                    </p>
                  )}
                </div>

                {!isUniversal && (
                  <div className="manual-compat-grid">
                {compatibilities.map((card, index) => (
                  <div className="manual-compat-card" key={card.id}>
                    <div className="manual-compat-card-header">
                      <strong>Vehículo {index + 1}</strong>
                      {index > 0 && (
                        <button type="button" className="manual-remove-compat" onClick={() => removeCompatibility(card.id)} aria-label={`Quitar vehículo ${index + 1}`}>
                          <Trash2 size={18} /> Quitar
                        </button>
                      )}
                    </div>
                    {card.savedWithoutDetail && (
                      <p className="manual-field-help" role="status">
                        No pudimos cargar el detalle de estos vehículos. Se mantienen como estaban; si cambias la marca, el modelo o los años, los eliges de nuevo.
                      </p>
                    )}
                    <div className="form-section-grid">
                      <div className="form-group">
                        <label className="form-label">Marca del vehículo {REQUIRED}</label>
                        <VehicleBrandSelect
                          value={card.vehicleBrand}
                          brands={nombresUnicosOrdenados(namesFromCatalog(vehicleBrandCatalog, VEHICLE_BRANDS_FALLBACK))}
                          onChange={(value) => updateCompatibility(card.id, { vehicleBrand: value })}
                          onMakeUniversal={() => setIsUniversal(true)}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Modelo {REQUIRED}</label>
                        <MultiOptionPicker
                          values={splitValues(card.vehicleModel)}
                          onChange={(values) => updateCompatibility(card.id, { vehicleModel: joinValues(values) })}
                          options={card.modelOptions}
                          placeholder="Selecciona uno o más modelos"
                          emptyText={card.vehicleBrand ? 'No hay modelos disponibles para esta marca.' : 'Selecciona primero una marca.'}
                          disabled={!card.vehicleBrand}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Año desde {REQUIRED}</label>
                        <select
                          className="form-control focus-accent"
                          value={card.vehicleYear || ''}
                          onChange={(e) => updateCompatibility(card.id, { vehicleYear: Number(e.target.value) })}
                        >
                          <option value="">Año desde</option>
                          {YEARS.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Año hasta {REQUIRED}</label>
                        <select
                          className="form-control focus-accent"
                          value={card.vehicleYearTo || ''}
                          onChange={(e) => updateCompatibility(card.id, { vehicleYearTo: Number(e.target.value) })}
                        >
                          <option value="">Año hasta</option>
                          {YEARS.filter((year) => !card.vehicleYear || year >= card.vehicleYear).map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                        {card.yearNote && <span className="manual-field-help" role="status">{card.yearNote}</span>}
                      </div>

                      <div className="form-group">
                        <label className="form-label">Motor (Cilindrada) {OPTIONAL}</label>
                        <select
                          className="form-control focus-accent"
                          value={card.motor || ''}
                          onChange={(e) => updateCompatibility(card.id, { motor: e.target.value })}
                          disabled={!card.vehicleModel}
                        >
                          <option value="">Todos los motores / No especificado</option>
                          {card.motorOptions?.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.etiqueta}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Versiones disponibles {REQUIRED}</label>
                        <MultiOptionPicker
                          values={card.vehicleVersionIds}
                          onChange={(values) => updateCompatibility(card.id, { vehicleVersionIds: values })}
                          options={card.versionOptions
                            .filter((version) => !card.motor || !version.motor || version.motor === card.motor || sonMotoresEquivalentes(version.motor, card.motor))
                            .map((version) => ({ label: version.nombre, value: String(version.id) }))}
                          placeholder="Selecciona versiones"
                          emptyText={
                            card.vehicleModel
                              ? 'No hay versiones disponibles para esos modelos y años.'
                              : 'Selecciona uno o más modelos para ver versiones.'
                          }
                          showSelectAll
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Referencia para este vehículo {OPTIONAL}</label>
                        <input
                          type="text"
                          className="form-control focus-accent"
                          placeholder="Ej. 04465-0K090"
                          value={card.oem}
                          onChange={(e) => updateCompatibility(card.id, { oem: sanitizeCodeInput(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                    <button type="button" className="btn btn-secondary manual-add-vehicle" onClick={addCompatibility}>
                      <PlusCircle size={18} /> Agregar otro vehículo
                    </button>
                  </div>
                )}

                <div className="form-group form-section-grid-full manual-chassis-field">
                  <span className="form-label">¿Necesitas el número de chasis para confirmar que le sirve?</span>
                  <span className="manual-field-help">
                    Si eliges "Sí", el precio no se muestra: el comprador te pide cotización con su número de chasis.
                  </span>
                  <div className="manual-chip-row" role="radiogroup" aria-label="¿Necesitas el número de chasis?">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={requiresChassis === 'false'}
                      className={`manual-chip ${requiresChassis === 'false' ? 'active' : ''}`}
                      onClick={() => setRequiresChassis('false')}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={requiresChassis === 'true'}
                      className={`manual-chip ${requiresChassis === 'true' ? 'active' : ''}`}
                      onClick={() => { setRequiresChassis('true'); setPricingMode('quote_only'); }}
                    >
                      Sí
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-card manual-form-section" style={{ borderLeft: '4px solid hsl(var(--primary))' }}>
              <div className="form-section-header primary">
                <span>4.</span>
                Fotos {OPTIONAL}
              </div>
              <div className="form-group form-section-grid-full">
                <label className="form-label">Agrega hasta 4 fotos claras desde distintos ángulos. Cada una hasta 5 MB. {OPTIONAL}</label>
                <div className="manual-photo-area">
                  <div className="manual-photo-grid">
                    {Array.from({ length: MAX_PHOTOS }).map((_, index) => {
                      const preview = imagePreviews[index];
                      return preview ? (
                        <div className="manual-photo-preview" key={preview}>
                          <img src={resolveImageUri(preview)} alt={`Foto ${index + 1}`} />
                          {/* Una foto publicada que se quita se borra al guardar, no antes. */}
                          <button type="button" onClick={() => removeImageAt(index)} aria-label={`Quitar foto ${index + 1}`}>
                            <X size={12} />
                          </button>
                          {!preview.startsWith('blob:') && (
                            <span className="manual-photo-published">Publicada</span>
                          )}
                        </div>
                      ) : (
                        <div className="manual-photo-empty" key={`empty-${index}`}>
                          <ImageIcon size={22} />
                        </div>
                      );
                    })}
                  </div>

                  <label
                    className={`form-control-file ${imagePreviews.length >= MAX_PHOTOS ? 'disabled' : ''}`}
                    style={{
                      flexGrow: 1,
                      cursor: imagePreviews.length >= MAX_PHOTOS ? 'not-allowed' : 'pointer',
                      opacity: imagePreviews.length >= MAX_PHOTOS ? 0.5 : 1,
                      pointerEvents: imagePreviews.length >= MAX_PHOTOS ? 'none' : 'auto'
                    }}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={imagePreviews.length >= MAX_PHOTOS}
                      style={{ display: 'none' }}
                      onChange={handleImageChange}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}>
                      <Upload size={16} />
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                        {imagePreviews.length >= MAX_PHOTOS
                          ? 'Límite máximo alcanzado (4/4 fotos)'
                          : `Agregar fotos (${imagePreviews.length}/${MAX_PHOTOS})`}
                      </span>
                    </div>
                  </label>
                </div>
                {imagePreviews.length === 0 && (
                  <div
                    style={{
                      background: 'hsl(var(--warning) / 0.12)',
                      border: '1px solid hsl(var(--warning) / 0.4)',
                      borderRadius: '10px',
                      padding: '0.75rem 1rem',
                      fontSize: '0.82rem',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      marginTop: '0.85rem'
                    }}
                  >
                    <AlertTriangle size={18} style={{ color: 'hsl(var(--warning))', flexShrink: 0 }} />
                    <span>
                      <strong>Atención:</strong> Si registras el producto sin fotos, se publicará automáticamente con la <strong>imagen genérica</strong> predeterminada de RepuesTop.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div
              className="form-section-card manual-form-section"
              style={{ borderLeft: '4px solid hsl(var(--success))' }}
              ref={(el) => { sectionRefs.current[5] = el; }}
              onBlur={markVisited(5)}
            >
              <div className="form-section-header success manual-section-header-status">
                <div><span>5.</span> Descripción y calidad</div>
                <SectionStatus missing={missingBySection[5]} visited={visitedSections.has(5)} />
              </div>
              {missingNote(5)}
              <div className="form-section-grid">
                <div className="form-group form-section-grid-full">
                  <label className="form-label">Descripción {REQUIRED}</label>
                  <textarea
                    className="form-control focus-success"
                    placeholder="Describe el repuesto: para qué sirve, medidas, qué incluye..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    style={{ resize: 'vertical' }}
                    required
                  />
                  <span className={`manual-counter ${description.trim().length < MIN_DESCRIPTION ? 'short' : ''}`} aria-live="polite">
                    {description.trim().length < MIN_DESCRIPTION
                      ? `Escribe al menos ${MIN_DESCRIPTION - description.trim().length} letras más.`
                      : `${description.length}/1000`}
                  </span>
                </div>

                <div className="form-group form-section-grid-full">
                  <label className="form-label">Calidad del producto {REQUIRED}</label>
                  <div className="manual-chip-row">
                    <button
                      type="button"
                      className={`manual-chip ${condition === 'ORIGINAL' ? 'active' : ''}`}
                      onClick={() => setCondition('ORIGINAL')}
                    >
                      Original
                    </button>
                    <button
                      type="button"
                      className={`manual-chip ${condition === 'ALTERNATIVO' ? 'active' : ''}`}
                      onClick={() => setCondition('ALTERNATIVO')}
                    >
                      Alternativo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer manual-upload-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
            {error && (
              <div
                style={{
                  background: 'hsl(var(--danger) / 0.12)',
                  border: '1px solid hsl(var(--danger) / 0.4)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.9rem',
                  fontSize: '0.82rem',
                  color: 'hsl(var(--danger))',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 600 }}>{error}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', width: '100%' }}>
              <button type="button" className="btn btn-secondary" onClick={attemptClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Guardando…' : editProduct ? 'Guardar cambios' : 'Publicar repuesto'}
              </button>
            </div>
          </div>
        </form>
        )}

        {showUnsavedConfirm && (
          <div className="manual-unsaved-modal-overlay" onClick={() => setShowUnsavedConfirm(false)}>
            <div className="manual-unsaved-card" onClick={(e) => e.stopPropagation()}>
              <h4>¿Descartar cambios no guardados?</h4>
              <p>Has modificado la información de este producto. Si sales ahora, se perderán todos los datos ingresados.</p>
              <div className="manual-unsaved-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowUnsavedConfirm(false)}>
                  Continuar editando
                </button>
                <button type="button" className="btn btn-danger" onClick={handleForceClose}>
                  Descartar cambios
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
