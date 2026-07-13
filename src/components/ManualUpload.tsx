import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, PlusCircle, Trash2, X, Image as ImageIcon, Upload } from 'lucide-react';
import type { Product } from '../db';
import { API_BASE_URL, resolveImageUri } from '../utils/imageHelper';

interface ManualUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Omit<Product, 'id' | 'lastUpdated'> & { id?: string }, imageFiles?: File[] | null) => Promise<void>;
  editProduct?: Product | null;
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
const REQUIRED = <span style={{ color: 'hsl(var(--danger))' }}>*</span>;
const YEARS = Array.from(
  { length: new Date().getFullYear() + 3 - 1990 },
  (_, index) => new Date().getFullYear() + 2 - index,
);

const CATEGORIES_FALLBACK = [
  'Frenos',
  'Suspension y direccion',
  'Motor',
  'Transmision',
  'Electricidad y sensores',
  'Carroceria',
  'Filtros y mantenimiento',
  'Iluminacion',
  'Neumaticos y llantas',
  'Accesorios',
];

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

const FLOW_RATE_BASE = 0.0289;
const FLOW_IVA = 0.19;
const FLOW_RATE_WITH_IVA = FLOW_RATE_BASE * (1 + FLOW_IVA);
const MAX_PHOTOS = 4;

async function loadCatalog(path: string): Promise<CatalogOption[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/catalogos/inventario/${path}`);
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function loadVehicleCatalogDetails(ids: number[]): Promise<VehicleCatalogDetail[]> {
  if (ids.length === 0) return [];
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/catalogos/inventario/vehiculo-catalogos?ids=${ids.join(',')}`);
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
  const currentYear = new Date().getFullYear();
  return {
    id: Math.random().toString(36).slice(2, 9),
    vehicleBrand: product?.vehicleBrand || '',
    vehicleModel: product?.vehicleModel || '',
    vehicleYear: product?.vehicleYear || currentYear,
    vehicleYearTo: product?.vehicleYearTo || product?.vehicleYear || currentYear,
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

function serviceFeeAmount(basePrice: number) {
  if (basePrice <= 0) return 0;
  let appRate = 0.10;
  if (basePrice > 100000 && basePrice <= 250000) appRate = 0.07;
  if (basePrice > 250000) appRate = 0.05;
  return Math.round(basePrice * appRate * 1.19 + basePrice * FLOW_RATE_WITH_IVA);
}

function calculateSellerEarnings(basePrice: number) {
  if (basePrice <= 0) return 0;
  return Math.max(0, Math.round(basePrice - serviceFeeAmount(basePrice)));
}

function calculateSuggestedPrice(desiredAmount: number) {
  if (desiredAmount <= 0) return 0;
  if (desiredAmount <= 84660) return Math.ceil(desiredAmount / 0.846609);
  if (desiredAmount < 88231) return 100001;
  if (desiredAmount <= 220577) return Math.ceil(desiredAmount / 0.882309);
  if (desiredAmount < 226528) return 250001;
  return Math.ceil(desiredAmount / 0.906109);
}

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
          {showSelectAll && (
            <button
              type="button"
              className="manual-select-all"
              onClick={() => onChange(uniqueOptions.map((option) => option.value))}
            >
              Seleccionar todo
            </button>
          )}

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
      )}
    </div>
  );
}

export const ManualUpload: React.FC<ManualUploadProps> = ({
  isOpen,
  onClose,
  onSave,
  editProduct,
}) => {
  const [sku, setSku] = useState('');
  const [oem, setOem] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Motor');
  const [partBrand, setPartBrand] = useState('');
  const [compatibilities, setCompatibilities] = useState<CompatibilityCard[]>(() => [createCompatibilityCard()]);
  const [pricingMode, setPricingMode] = useState<'show_price' | 'quote_only'>('show_price');
  const [price, setPrice] = useState<number>(0);
  const [stock, setStock] = useState<number>(10);
  const [requiresChassis, setRequiresChassis] = useState<'false' | 'true'>('false');
  const [condition, setCondition] = useState<'ORIGINAL' | 'ALTERNATIVO'>('ORIGINAL');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [catalogCategories, setCatalogCategories] = useState<string[]>(CATEGORIES_FALLBACK);
  const [catalogPartBrands, setCatalogPartBrands] = useState<string[]>(PART_BRANDS_FALLBACK);
  const [vehicleBrandCatalog, setVehicleBrandCatalog] = useState<CatalogOption[]>([]);

  useEffect(() => {
    return () => {
      imagePreviews.forEach((preview) => {
        if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
      });
    };
  }, [imagePreviews]);

  useEffect(() => {
    let active = true;

    if (editProduct) {
      // Initializes the form fields from the product being edited. Multiple
      // synchronous setState calls here are the standard "seed form state
      // from a prop" pattern, not an accidental render loop — reviewed,
      // deliberate exception (QA-SRC-002).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSku(editProduct.sku);
      setOem(editProduct.oem || '');
      setName(editProduct.name);
      setCategory(editProduct.category || 'Motor');
      setPartBrand(editProduct.partBrand);
      setCompatibilities([createCompatibilityCard(editProduct)]);
      const groups = parseCompatibilityGroups(editProduct);
      if (groups.length > 0) {
        Promise.all(groups.map((ids) => loadVehicleCatalogDetails(ids))).then((detailGroups) => {
          if (!active) return;
          const restoredCards = detailGroups
            .map((details) => createCompatibilityCardFromDetails(details, editProduct))
            .filter((card) => card.vehicleVersionIds.length > 0);
          if (restoredCards.length > 0) setCompatibilities(restoredCards);
        });
      }
      setPricingMode(editProduct.pricingMode || 'show_price');
      setPrice(editProduct.price);
      setStock(editProduct.stock || 0);
      setRequiresChassis(editProduct.requiresChassis ? 'true' : 'false');
      setCondition(editProduct.condition || 'ORIGINAL');
      setDescription(editProduct.description || '');
      setImage(editProduct.image || '');
      setImagePreviews(editProduct.image ? [editProduct.image] : []);
      setImageFiles([]);
    } else {
      setSku('');
      setOem('');
      setName('');
      setCategory('Motor');
      setPartBrand('');
      setCompatibilities([createCompatibilityCard()]);
      setPricingMode('show_price');
      setPrice(0);
      setStock(10);
      setRequiresChassis('false');
      setCondition('ORIGINAL');
      setDescription('');
      setImage('');
      setImagePreviews([]);
      setImageFiles([]);
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
      setCatalogCategories(namesFromCatalog(categories, CATEGORIES_FALLBACK));
      setVehicleBrandCatalog(vehicleBrands);
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
  }, [isOpen, vehicleBrandCatalog, compatibilityCatalogKey]);

  if (!isOpen) return null;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length > MAX_PHOTOS) {
      setError('Puedes cargar maximo 4 fotos por producto.');
      return;
    }

    const validFiles = selectedFiles.slice(0, MAX_PHOTOS);
    const oversized = validFiles.find((file) => file.size > 2 * 1024 * 1024);
    if (oversized) {
      setError('Cada imagen debe pesar maximo 2MB. Selecciona archivos mas livianos.');
      return;
    }

    imagePreviews.forEach((preview) => {
      if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    });
    setImage('');
    setImageFiles(validFiles);
    setImagePreviews(validFiles.map((file) => URL.createObjectURL(file)));
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
        if (next.vehicleYearTo < next.vehicleYear) {
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
      setError('Completa nombre, categoria, marca y SKU para registrar el producto.');
      setSaving(false);
      return;
    }

    if (pricingMode === 'show_price' && price <= 0) {
      setError('Completa el precio para registrar el producto o cambia a modo cotizacion.');
      setSaving(false);
      return;
    }

    if (stock < 0) {
      setError('El stock disponible no puede ser menor a 0.');
      setSaving(false);
      return;
    }

    if (compatibilities.some((card) => card.vehicleYearTo < card.vehicleYear)) {
      setError('El ano hasta no puede ser menor que el ano desde.');
      setSaving(false);
      return;
    }

    if (!description.trim()) {
      setError('La descripcion es obligatoria.');
      setSaving(false);
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
            oemReference: card.oem,
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

      const productPayload: Omit<Product, 'id' | 'lastUpdated'> & { id?: string } = {
        sku: sku.trim().toUpperCase(),
        oem: primaryCompatibility.oem.trim().toUpperCase(),
        name: name.trim(),
        category,
        partBrand: partBrand.trim(),
        vehicleBrand: primaryCompatibility.vehicleBrand.trim(),
        vehicleModel: primaryCompatibility.vehicleModel.trim(),
        vehicleYear: Number(primaryCompatibility.vehicleYear),
        vehicleYearTo: Number(primaryCompatibility.vehicleYearTo),
        vehicleVersion: joinValues(primaryVersionLabels),
        pricingMode,
        price: pricingMode === 'quote_only' ? 0 : Number(price),
        stock: Number(stock),
        requiresChassis: requiresChassis === 'true',
        condition,
        description: description.trim(),
        image: editProduct && imageFiles.length === 0 ? image : '',
        vehiculoCatalogoIds: allCatalogIds,
        compatibilityGroupsJson: JSON.stringify(compatibilityGroups),
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

  const priceFee = serviceFeeAmount(price);
  const sellerEarnings = calculateSellerEarnings(price);
  const suggestedPrice = calculateSuggestedPrice(price);

  return (
    <div className="modal-overlay">
      <div className="modal-content manual-upload-modal">
        <div className="modal-header manual-upload-header">
          <h3>
            <span className="manual-upload-title-dot"></span>
            {editProduct ? 'Editar producto' : 'Crear producto'}
          </h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body manual-upload-body">
            {error && (
              <div className="auth-error" style={{ marginBottom: '1.5rem' }}>
                {error}
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
                </div>

                <div className="form-group">
                  <label className="form-label">Marca {REQUIRED}</label>
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
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
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
                  <label className="form-label">{pricingMode === 'quote_only' ? 'Precio oculto' : 'Precio de venta'} {pricingMode === 'show_price' ? REQUIRED : null}</label>
                  <input
                    type="number"
                    className="form-control focus-success"
                    placeholder={pricingMode === 'quote_only' ? 'Se ocultara en el resumen' : '0'}
                    value={pricingMode === 'quote_only' ? '' : price || ''}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    disabled={pricingMode === 'quote_only'}
                    required={pricingMode === 'show_price'}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Stock disponible {REQUIRED}</label>
                  <input
                    type="number"
                    className="form-control focus-success"
                    placeholder="Ej. 10"
                    value={stock}
                    onChange={(e) => setStock(Number(e.target.value))}
                    required
                  />
                </div>
              </div>

              {pricingMode !== 'quote_only' && price > 0 && (
                <div className="manual-pricing-helper">
                  <div className="manual-pricing-row">
                    <span>Tarifa por servicio Repuestop (incluye IVA):</span>
                    <strong className="manual-pricing-fee">-${formatCLP(priceFee)}</strong>
                  </div>
                  <div className="manual-pricing-row">
                    <strong>Recibiras liquido:</strong>
                    <strong className="manual-pricing-earnings">${formatCLP(sellerEarnings)}</strong>
                  </div>

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
                  Compatibilidad
                </div>
                <button type="button" className="manual-add-compat" onClick={addCompatibility} aria-label="Agregar compatibilidad">
                  <PlusCircle size={26} />
                </button>
              </div>
              <div className="manual-compat-list">
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
                  <label className="form-label">Marca vehiculo</label>
                  <SelectOrInput
                    className="form-control focus-accent"
                    placeholder="Selecciona una marca"
                    value={card.vehicleBrand}
                    onChange={(value) => updateCompatibility(card.id, { vehicleBrand: value })}
                    options={namesFromCatalog(vehicleBrandCatalog, VEHICLE_BRANDS_FALLBACK)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Modelo</label>
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
                  <label className="form-label">Año desde</label>
                  <select
                    className="form-control focus-accent"
                    value={card.vehicleYear}
                    onChange={(e) => updateCompatibility(card.id, { vehicleYear: Number(e.target.value) })}
                  >
                    {YEARS.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Año hasta</label>
                  <select
                    className="form-control focus-accent"
                    value={card.vehicleYearTo}
                    onChange={(e) => updateCompatibility(card.id, { vehicleYearTo: Number(e.target.value) })}
                  >
                    {YEARS.filter((year) => year >= card.vehicleYear).map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Versiones disponibles</label>
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
                  <label className="form-label">Referencia / Parte OEM</label>
                  <input
                    type="text"
                    className="form-control focus-accent"
                    placeholder="Ej. 04465-0K090"
                    value={card.oem}
                    onChange={(e) => updateCompatibility(card.id, { oem: e.target.value })}
                  />
                </div>

                    </div>
                  </div>
                ))}

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
                Fotos
              </div>
              <div className="form-group form-section-grid-full">
                <label className="form-label">Agrega hasta 4 fotos claras desde diferentes angulos.</label>
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

                  <label className="form-control-file" style={{ flexGrow: 1 }}>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={handleImageChange}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}>
                      <Upload size={16} />
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                        {editProduct ? `Reemplazar fotos (${imagePreviews.length}/${MAX_PHOTOS})` : `Cargar fotos (${imagePreviews.length}/${MAX_PHOTOS})`}
                      </span>
                    </div>
                  </label>
                </div>
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

          <div className="modal-footer manual-upload-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : editProduct ? 'Guardar cambios' : 'Registrar producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
