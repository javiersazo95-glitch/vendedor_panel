import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Globe, PlusCircle, Trash2, X, Image as ImageIcon, Upload } from 'lucide-react';
import type { Product } from '../db';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL, DEFAULT_PRODUCT_IMAGE_URL, resolveImageUri } from '../utils/imageHelper';
import { calculateSellerEarnings, calculateSuggestedPrice, pricingFeeBreakdown, serviceFeeAmount, FLOW_RATE_BASE } from '../utils/pricing';
import { useFocusTrap } from '../utils/useFocusTrap';

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
}

type CatalogOption = {
  id: number;
  nombre: string;
};

type PickerOption = string | { label: string; value: string };

type CompatibilityCard = {
  id: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleYearTo: number;
  vehicleVersionIds: string[];
  oem: string;
  modelOptions: string[];
  versionOptions: CatalogOption[];
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
const REQUIRED = <span style={{ color: 'hsl(var(--danger))', fontWeight: 700, marginLeft: '3px' }}>*</span>;
const OPTIONAL = (
  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>
    (Opcional)
  </span>
);
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

function parseCompatibilityGroups(product: Product): number[][] {
  if (product.compatibilityGroupsJson) {
    try {
      const parsed = JSON.parse(product.compatibilityGroupsJson);
      if (Array.isArray(parsed)) {
        const groups = parsed
          .map((group) => {
            const ids = Array.isArray(group?.vehiculoCatalogoIds) ? group.vehiculoCatalogoIds : [];
            return ids.map((id: unknown) => Number(id)).filter((id: number) => !Number.isNaN(id));
          })
          .filter((ids) => ids.length > 0);
        if (groups.length > 0) return groups;
      }
    } catch {
      // Continue with flat ids fallback.
    }
  }

  return product.vehiculoCatalogoIds && product.vehiculoCatalogoIds.length > 0
    ? [product.vehiculoCatalogoIds]
    : [];
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

function formatCLP(value: number) {
  return new Intl.NumberFormat('es-CL').format(value);
}

const FLOW_RATE_LABEL = `${(FLOW_RATE_BASE * 100).toFixed(2).replace('.', ',')}%`;

function SelectOrInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  required,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  className: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [isOther, setIsOther] = useState(false);
  const uniqueOptions = Array.from(new Set(options.filter(Boolean)));
  const hasValue = uniqueOptions.some((option) => option.toLowerCase() === value.toLowerCase());
  const selectValue = isOther || (value && !hasValue) ? OTHER_VALUE : value;

  useEffect(() => {
    // Resets the "other" free-text mode once the typed value matches a real
    // catalog option again. Reviewed, deliberate exception (QA-SRC-002).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasValue) setIsOther(false);
  }, [hasValue]);

  return (
    <>
      <select
        className={className}
        value={selectValue}
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
        <option value={OTHER_VALUE}>Otro</option>
      </select>

      {(isOther || (value && !hasValue)) && (
        <input
          type="text"
          className={className}
          placeholder="Escribe otra opcion"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
        />
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
  const initialSnapshotRef = useRef<string | null>(null);

  const computeSnapshot = useCallback(() => {
    return JSON.stringify({
      sku: sku.trim(),
      oem: oem.trim(),
      name: name.trim(),
      category,
      subcategory,
      partBrand: partBrand.trim(),
      pricingMode,
      price,
      stock,
      requiresChassis,
      condition,
      description: description.trim(),
      isUniversal,
      compatibilities: compatibilities.map((card) => ({
        b: card.vehicleBrand,
        m: card.vehicleModel,
        y: card.vehicleYear,
        yt: card.vehicleYearTo,
        v: card.vehicleVersionIds,
        o: card.oem,
      })),
      filesCount: imageFiles.length,
    });
  }, [sku, oem, name, category, subcategory, partBrand, pricingMode, price, stock, requiresChassis, condition, description, isUniversal, compatibilities, imageFiles.length]);

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
      setSku(editProduct.sku);
      setOem(editProduct.oem || '');
      setName(editProduct.name);
      setCategory(editProduct.category || 'Motor');
      setSubcategory(editProduct.subcategory || '');
      setPartBrand(editProduct.partBrand);
      const initialCards = [createCompatibilityCard(editProduct)];
      setCompatibilities(initialCards);
      const groups = parseCompatibilityGroups(editProduct);
      if (groups.length > 0) {
        Promise.all(groups.map((ids) => loadVehicleCatalogDetails(ids))).then((detailGroups) => {
          if (!active) return;
          const restoredCards = detailGroups
            .map((details) => createCompatibilityCardFromDetails(details, editProduct))
            .filter((card) => card.vehicleVersionIds.length > 0);
          if (restoredCards.length > 0) {
            setCompatibilities(restoredCards);
            initialSnapshotRef.current = JSON.stringify({
              sku: editProduct.sku.trim(),
              oem: (editProduct.oem || '').trim(),
              name: editProduct.name.trim(),
              category: editProduct.category || 'Motor',
              subcategory: editProduct.subcategory || '',
              partBrand: editProduct.partBrand.trim(),
              pricingMode: editProduct.pricingMode || 'show_price',
              price: editProduct.price,
              stock: editProduct.stock || 0,
              requiresChassis: editProduct.requiresChassis ? 'true' : 'false',
              condition: editProduct.condition || 'ORIGINAL',
              description: (editProduct.description || '').trim(),
              isUniversal: editProduct.esUniversal === true,
              compatibilities: restoredCards.map((card) => ({
                b: card.vehicleBrand,
                m: card.vehicleModel,
                y: card.vehicleYear,
                yt: card.vehicleYearTo,
                v: card.vehicleVersionIds,
                o: card.oem,
              })),
              filesCount: 0,
            });
          }
        });
      }
      setPricingMode(editProduct.pricingMode || 'show_price');
      setPrice(editProduct.price);
      setStock(editProduct.stock || 0);
      setRequiresChassis(editProduct.requiresChassis ? 'true' : 'false');
      setIsUniversal(editProduct.esUniversal === true);
      setCondition(editProduct.condition || 'ORIGINAL');
      setDescription(editProduct.description || '');
      setImage(editProduct.image || '');
      setImagePreviews(editProduct.image ? [editProduct.image] : []);
      setImageFiles([]);

      initialSnapshotRef.current = JSON.stringify({
        sku: editProduct.sku.trim(),
        oem: (editProduct.oem || '').trim(),
        name: editProduct.name.trim(),
        category: editProduct.category || 'Motor',
        partBrand: editProduct.partBrand.trim(),
        pricingMode: editProduct.pricingMode || 'show_price',
        price: editProduct.price,
        stock: editProduct.stock || 0,
        requiresChassis: editProduct.requiresChassis ? 'true' : 'false',
        condition: editProduct.condition || 'ORIGINAL',
        description: (editProduct.description || '').trim(),
        isUniversal: editProduct.esUniversal === true,
        compatibilities: initialCards.map((card) => ({
          b: card.vehicleBrand,
          m: card.vehicleModel,
          y: card.vehicleYear,
          yt: card.vehicleYearTo,
          v: card.vehicleVersionIds,
          o: card.oem,
        })),
        filesCount: 0,
      });
    } else {
      setSku('');
      setOem('');
      setName('');
      setCategory('');
      setSubcategory('');
      setPartBrand('');
      const defaultCard = [createCompatibilityCard()];
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

      initialSnapshotRef.current = JSON.stringify({
        sku: '',
        oem: '',
        name: '',
        category: '',
        subcategory: '',
        partBrand: '',
        pricingMode: 'show_price',
        price: 0,
        stock: 1,
        requiresChassis: 'false',
        condition: 'ORIGINAL',
        description: '',
        isUniversal: false,
        compatibilities: defaultCard.map((card) => ({
          b: card.vehicleBrand,
          m: card.vehicleModel,
          y: card.vehicleYear,
          yt: card.vehicleYearTo,
          v: card.vehicleVersionIds,
          o: card.oem,
        })),
        filesCount: 0,
      });
    }
    setError(null);

    return () => {
      active = false;
    };
  }, [editProduct, isOpen]);

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
        if (!card.vehicleBrand) {
          return { id: card.id, modelOptions: [], versionOptions: [] };
        }

        const selectedBrand = vehicleBrandCatalog.find(
          (brand) => brand.nombre.toLowerCase() === card.vehicleBrand.toLowerCase(),
        );
        const models = selectedBrand
          ? namesFromCatalog(await loadCatalog(`marcas-vehiculo/${selectedBrand.id}/modelos`), MODELS_FALLBACK[card.vehicleBrand] || [])
          : MODELS_FALLBACK[card.vehicleBrand] || [];

        const selectedModels = splitValues(card.vehicleModel);
        if (selectedModels.length === 0) {
          return { id: card.id, modelOptions: models, versionOptions: [] };
        }

        const versionGroups = await Promise.all(
          selectedModels.map((model) =>
            loadCatalog(`versiones?marca=${encodeURIComponent(card.vehicleBrand)}&modelo=${encodeURIComponent(model)}&anioDesde=${card.vehicleYear}&anioHasta=${card.vehicleYearTo}`),
          ),
        );
        const versionOptions = Array.from(
          new Map(versionGroups.flat().map((version) => [String(version.id), version])).values(),
        );

        return { id: card.id, modelOptions: models, versionOptions };
      }),
    ).then((results) => {
      if (!active) return;
      setCompatibilities((current) =>
        current.map((card) => {
          const result = results.find((item) => item.id === card.id);
          if (!result) return card;
          const validVersionIds = new Set(result.versionOptions.map((version) => String(version.id)));
          return {
            ...card,
            modelOptions: result.modelOptions,
            versionOptions: result.versionOptions,
            vehicleVersionIds: card.vehicleVersionIds.filter((id) => validVersionIds.has(id)),
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
      bodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
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
    const oversized = filesToAdd.find((file) => file.size > 2 * 1024 * 1024);
    if (oversized) {
      triggerError('Cada imagen debe pesar máximo 2MB. Selecciona archivos más livianos.');
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
        }
        if (fields.vehicleModel !== undefined || fields.vehicleYear !== undefined || fields.vehicleYearTo !== undefined) {
          next.vehicleVersionIds = [];
          next.versionOptions = [];
        }
        if (fields.vehicleYear !== undefined && fields.vehicleYear > 0) {
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
    setCompatibilities((current) => [
      ...current,
      { ...createCompatibilityCard(), oem: current[0]?.oem || oem },
    ]);
  };

  const removeCompatibility = (id: string) => {
    setCompatibilities((current) => (current.length <= 1 ? current : current.filter((card) => card.id !== id)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    if (!name.trim() || !category.trim() || !partBrand.trim() || !sku.trim()) {
      triggerError('Completa nombre, categoría, marca y SKU para registrar el producto.');
      return;
    }

    if (pricingMode === 'show_price' && price <= 0) {
      triggerError('Completa el precio de venta para registrar el producto o cambia a modo cotización.');
      return;
    }

    if (stock < 0) {
      triggerError('El stock disponible no puede ser menor a 0.');
      return;
    }

    // Validation 1: Compatibility is mandatory for the product, unless it is universal
    // (compatible con cualquier vehiculo -> no se pide detalle de compatibilidad).
    if (!isUniversal) {
    const firstCompat = compatibilities[0];
    const hasFirstBrand = Boolean(firstCompat?.vehicleBrand?.trim());
    const hasFirstModel = Boolean(firstCompat?.vehicleModel?.trim());
    const hasFirstYears = Boolean(firstCompat?.vehicleYear > 0 && firstCompat?.vehicleYearTo > 0);
    const hasFirstVersion = Boolean(firstCompat?.vehicleVersionIds && firstCompat.vehicleVersionIds.length > 0);

    if (!hasFirstBrand || !hasFirstModel || !hasFirstYears || !hasFirstVersion) {
      if (!hasFirstBrand) {
        triggerError('Selecciona la marca del vehículo compatible.');
        return;
      }
      if (!hasFirstModel) {
        triggerError('Selecciona al menos un modelo de vehículo compatible.');
        return;
      }
      if (!hasFirstYears) {
        triggerError('Selecciona el año desde y el año hasta del vehículo compatible.');
        return;
      }
      if (!hasFirstVersion) {
        triggerError('Selecciona al menos una versión disponible del vehículo compatible.');
        return;
      }
    }

    for (let i = 1; i < compatibilities.length; i++) {
      const card = compatibilities[i];
      const hasBrand = Boolean(card.vehicleBrand.trim());
      const hasModel = Boolean(card.vehicleModel.trim());
      const hasYears = Boolean(card.vehicleYear > 0 && card.vehicleYearTo > 0);
      const hasVersion = Boolean(card.vehicleVersionIds && card.vehicleVersionIds.length > 0);

      if (hasBrand || hasModel || hasYears || hasVersion) {
        if (!hasBrand) {
          triggerError(`En la compatibilidad #${i + 1}, selecciona la marca del vehículo.`);
          return;
        }
        if (!hasModel) {
          triggerError(`En la compatibilidad #${i + 1}, selecciona al menos un modelo.`);
          return;
        }
        if (!hasYears) {
          triggerError(`En la compatibilidad #${i + 1}, selecciona el año desde y el año hasta.`);
          return;
        }
        if (!hasVersion) {
          triggerError(`En la compatibilidad #${i + 1}, selecciona al menos una versión disponible.`);
          return;
        }
      }
    }

    if (compatibilities.some((card) => card.vehicleYearTo > 0 && card.vehicleYear > 0 && card.vehicleYearTo < card.vehicleYear)) {
      triggerError('El año hasta no puede ser menor que el año desde.');
      return;
    }
    }

    // Validation 3: Minimum description length (15 characters)
    if (!description.trim() || description.trim().length < 15) {
      triggerError('La descripción es obligatoria y debe tener al menos 15 caracteres.');
      return;
    }

    try {
      const primaryCompatibility = compatibilities[0] || createCompatibilityCard();
      const compatibilityGroups = compatibilities
        .map((card) => {
          const selectedIds = card.vehicleVersionIds.length > 0
            ? card.vehicleVersionIds
            : card.versionOptions.map((version) => String(version.id));
          const selectedVersionLabels = card.versionOptions
            .filter((version) => selectedIds.includes(String(version.id)))
            .map((version) => version.nombre);
          return {
            vehiculoCatalogoIds: Array.from(new Set(selectedIds)).map(Number).filter((id) => !Number.isNaN(id)),
            compatBrand: card.vehicleBrand,
            model: card.vehicleModel,
            yearFrom: String(card.vehicleYear),
            yearTo: String(card.vehicleYearTo),
            oemReference: sanitizeCodeInput(card.oem),
            versionLabels: selectedVersionLabels,
          };
        })
        .filter((group) => group.vehiculoCatalogoIds.length > 0 || group.compatBrand || group.model);
      const allCatalogIds = Array.from(
        new Set(compatibilityGroups.flatMap((group) => group.vehiculoCatalogoIds)),
      );
      const primaryVersionLabels = primaryCompatibility.versionOptions
        .filter((version) =>
          (primaryCompatibility.vehicleVersionIds.length > 0
            ? primaryCompatibility.vehicleVersionIds
            : primaryCompatibility.versionOptions.map((item) => String(item.id))
          ).includes(String(version.id)),
        )
        .map((version) => version.nombre);

      const finalImage = editProduct && imageFiles.length === 0 && image
        ? image
        : imageFiles.length > 0
        ? ''
        : DEFAULT_PRODUCT_IMAGE_URL;

      const productPayload: Omit<Product, 'id' | 'lastUpdated'> & { id?: string } = {
        sku: sanitizeCodeInput(sku),
        oem: sanitizeCodeInput(isUniversal ? oem : primaryCompatibility.oem),
        name: name.trim(),
        category,
        subcategory: subcategory.trim() || undefined,
        partBrand: partBrand.trim(),
        esUniversal: isUniversal,
        vehicleBrand: isUniversal ? '' : primaryCompatibility.vehicleBrand.trim(),
        vehicleModel: isUniversal ? '' : primaryCompatibility.vehicleModel.trim(),
        vehicleYear: isUniversal ? 0 : Number(primaryCompatibility.vehicleYear),
        vehicleYearTo: isUniversal ? 0 : Number(primaryCompatibility.vehicleYearTo),
        vehicleVersion: isUniversal ? '' : joinValues(primaryVersionLabels),
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
      }

      await onSave(productPayload, imageFiles.length > 0 ? imageFiles : null);
      onClose();
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
              {editProduct ? `SKU: ${editProduct.sku}` : 'Carga individual 1:1'}
            </span>
          </div>
          <button type="button" className="btn-icon" onClick={attemptClose} aria-label="Cerrar formulario de producto">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} onInvalid={handleFormInvalid} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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

            <div className="form-section-card manual-form-section" style={{ borderLeft: '4px solid hsl(var(--primary))' }}>
              <div className="form-section-header primary">
                <span>1.</span>
                Informacion basica
              </div>
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
                  <label className="form-label">Categoria {REQUIRED}</label>
                  <SelectOrInput
                    className="form-control focus-primary"
                    placeholder="Selecciona una categoria"
                    value={category}
                    onChange={setCategory}
                    options={catalogCategories}
                    required
                  />
                  {catalogError && (
                    <p role="alert" style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'hsl(var(--destructive))' }}>
                      {catalogError}
                    </p>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Subcategoria {OPTIONAL}</label>
                  <select
                    className="form-control focus-primary"
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    disabled={!category || catalogSubcategories.length === 0}
                  >
                    <option value="">
                      {!category
                        ? 'Selecciona primero una categoria'
                        : catalogSubcategories.length === 0
                        ? 'Sin subcategorias disponibles'
                        : 'Selecciona una subcategoria'}
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
                    required
                  />
                </div>

                <div className="form-group form-section-grid-full">
                  <label className="form-label">SKU (codigo interno) {REQUIRED}</label>
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

            <div className="form-section-card manual-form-section" style={{ borderLeft: '4px solid hsl(var(--success))' }}>
              <div className="form-section-header success">
                <span>2.</span>
                Precio y disponibilidad
              </div>
              <div className="manual-radio-row">
                <button
                  type="button"
                  className={`manual-radio-card ${pricingMode === 'show_price' ? 'active' : ''}`}
                  onClick={() => setPricingMode('show_price')}
                  disabled={requiresChassis === 'true'}
                >
                  <strong>Mostrar precio</strong>
                  <span>El precio sera visible para los compradores</span>
                </button>
                <button
                  type="button"
                  className={`manual-radio-card ${pricingMode === 'quote_only' ? 'active' : ''}`}
                  onClick={() => setPricingMode('quote_only')}
                >
                  <strong>Solo cotizar</strong>
                  <span>Los compradores enviaran una cotizacion</span>
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
                    placeholder={pricingMode === 'quote_only' ? 'Se ocultara en el resumen' : '0'}
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

            <div className="form-section-card manual-form-section" style={{ borderLeft: '4px solid hsl(var(--accent))' }}>
              <div className="form-section-header accent manual-section-header-actions">
                <div>
                  <span>3.</span>
                  Compatibilidad {REQUIRED}
                </div>
                {!isUniversal && (
                  <button type="button" className="manual-add-compat" onClick={addCompatibility} aria-label="Agregar compatibilidad">
                    <PlusCircle size={26} />
                  </button>
                )}
              </div>
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
                </div>

                {!isUniversal && (
                  <div className="manual-compat-grid">
                {compatibilities.map((card, index) => (
                  <div className="manual-compat-card" key={card.id}>
                    <div className="manual-compat-card-header">
                      <strong>Compatibilidad #{index + 1}</strong>
                      {index > 0 && (
                        <button type="button" className="manual-remove-compat" onClick={() => removeCompatibility(card.id)} aria-label="Eliminar compatibilidad">
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                    <div className="form-section-grid">
                      <div className="form-group">
                        <label className="form-label">Marca vehiculo {REQUIRED}</label>
                        <SelectOrInput
                          className="form-control focus-accent"
                          placeholder="Selecciona una marca"
                          value={card.vehicleBrand}
                          onChange={(value) => updateCompatibility(card.id, { vehicleBrand: value })}
                          options={namesFromCatalog(vehicleBrandCatalog, VEHICLE_BRANDS_FALLBACK)}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Modelo {REQUIRED}</label>
                        <MultiOptionPicker
                          values={splitValues(card.vehicleModel)}
                          onChange={(values) => updateCompatibility(card.id, { vehicleModel: joinValues(values) })}
                          options={card.modelOptions}
                          placeholder="Selecciona uno o mas modelos"
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
                      </div>

                      <div className="form-group">
                        <label className="form-label">Versiones disponibles {REQUIRED}</label>
                        <MultiOptionPicker
                          values={card.vehicleVersionIds}
                          onChange={(values) => updateCompatibility(card.id, { vehicleVersionIds: values })}
                          options={card.versionOptions.map((version) => ({ label: version.nombre, value: String(version.id) }))}
                          placeholder="Selecciona versiones"
                          emptyText={
                            card.vehicleModel
                              ? 'No hay versiones disponibles para esos modelos y anos.'
                              : 'Selecciona uno o mas modelos para ver versiones.'
                          }
                          showSelectAll
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Referencia / Parte OEM {OPTIONAL}</label>
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
                  </div>
                )}

                <div className="form-group form-section-grid-full manual-chassis-field">
                  <label className="form-label">Requiere Chasis? {REQUIRED}</label>
                  <select
                    className="form-control focus-accent"
                    value={requiresChassis}
                    onChange={(e) => {
                      const value = e.target.value as 'false' | 'true';
                      setRequiresChassis(value);
                      if (value === 'true') setPricingMode('quote_only');
                    }}
                    required
                  >
                    <option value="false">No</option>
                    <option value="true">Si</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="form-section-card manual-form-section" style={{ borderLeft: '4px solid hsl(var(--primary))' }}>
              <div className="form-section-header primary">
                <span>4.</span>
                Fotos {OPTIONAL}
              </div>
              <div className="form-group form-section-grid-full">
                <label className="form-label">Agrega hasta 4 fotos claras desde diferentes angulos. {OPTIONAL}</label>
                <div className="manual-photo-area">
                  <div className="manual-photo-grid">
                    {Array.from({ length: MAX_PHOTOS }).map((_, index) => {
                      const preview = imagePreviews[index];
                      return preview ? (
                        <div className="manual-photo-preview" key={preview}>
                          <img src={resolveImageUri(preview)} alt={`Foto ${index + 1}`} />
                          <button type="button" onClick={() => removeImageAt(index)} aria-label="Quitar foto">
                            <X size={12} />
                          </button>
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

            <div className="form-section-card manual-form-section" style={{ borderLeft: '4px solid hsl(var(--success))' }}>
              <div className="form-section-header success">
                <span>5.</span>
                Descripcion y calidad
              </div>
              <div className="form-section-grid">
                <div className="form-group form-section-grid-full">
                  <label className="form-label">Descripcion {REQUIRED}</label>
                  <textarea
                    className="form-control focus-success"
                    placeholder="Describe el producto, caracteristicas, beneficios y cualquier detalle importante..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    style={{ resize: 'vertical' }}
                    required
                  />
                  <span className="manual-counter">{description.length}/1000</span>
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
                {saving ? 'Guardando...' : editProduct ? 'Guardar cambios' : 'Registrar producto'}
              </button>
            </div>
          </div>
        </form>

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
