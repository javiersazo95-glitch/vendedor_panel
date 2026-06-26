import React, { useState, useEffect } from 'react';
import { X, Image as ImageIcon, Upload } from 'lucide-react';
import type { Product } from '../db';
import { resolveImageUri } from '../utils/imageHelper';

interface ManualUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Omit<Product, 'id' | 'lastUpdated'> & { id?: string }, imageFile?: File | null) => Promise<void>;
  editProduct?: Product | null;
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
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState(new Date().getFullYear());
  const [vehicleVersion, setVehicleVersion] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [stock, setStock] = useState<number>(10);
  const [description, setDescription] = useState('');
  const [image, setImage] = useState(''); // Base64 representation or proxy URL
  const [imagePreview, setImagePreview] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Revoke the object URL to avoid memory leaks
  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  // Categories list
  const CATEGORIES = ['Motor', 'Frenos', 'Suspensión', 'Filtros', 'Transmisión', 'Eléctrico', 'Carrocería', 'Accesorios'];

  useEffect(() => {
    if (editProduct) {
      setSku(editProduct.sku);
      setOem(editProduct.oem || '');
      setName(editProduct.name);
      setCategory(editProduct.category || 'Motor');
      setPartBrand(editProduct.partBrand);
      setVehicleBrand(editProduct.vehicleBrand);
      setVehicleModel(editProduct.vehicleModel);
      setVehicleYear(editProduct.vehicleYear);
      setVehicleVersion(editProduct.vehicleVersion);
      setPrice(editProduct.price);
      setStock(editProduct.stock || 0);
      setDescription(editProduct.description || '');
      setImage(editProduct.image || '');
      setImagePreview(editProduct.image || '');
      setImageFile(null);
    } else {
      // Reset form
      setSku('');
      setOem('');
      setName('');
      setCategory('Motor');
      setPartBrand('');
      setVehicleBrand('');
      setVehicleModel('');
      setVehicleYear(new Date().getFullYear());
      setVehicleVersion('');
      setPrice(0);
      setStock(10);
      setDescription('');
      setImage('');
      setImagePreview('');
      setImageFile(null);
    }
    setError(null);
  }, [editProduct, isOpen]);

  if (!isOpen) return null;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('La imagen excede el límite de 2MB. Selecciona un archivo más liviano.');
        return;
      }
      
      setImageFile(file);
      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    // Frontend Validations
    if (!sku.trim()) {
      setError('El SKU es obligatorio.');
      setSaving(false);
      return;
    }
    if (!name.trim()) {
      setError('El Nombre es obligatorio.');
      setSaving(false);
      return;
    }
    if (name.length > 150) {
      setError('El Nombre no puede superar los 150 caracteres.');
      setSaving(false);
      return;
    }
    if (!partBrand.trim()) {
      setError('La Marca del Repuesto es obligatoria.');
      setSaving(false);
      return;
    }
    if (price <= 0) {
      setError('El precio debe ser un número mayor a 0.');
      setSaving(false);
      return;
    }
    if (stock < 0) {
      setError('El stock disponible no puede ser menor a 0.');
      setSaving(false);
      return;
    }
    if (vehicleYear < 1900 || vehicleYear > new Date().getFullYear() + 2) {
      setError(`Año de vehículo inválido (debe estar entre 1900 y ${new Date().getFullYear() + 2}).`);
      setSaving(false);
      return;
    }

    try {
      const productPayload: Omit<Product, 'id' | 'lastUpdated'> & { id?: string } = {
        sku: sku.trim().toUpperCase(),
        oem: oem.trim().toUpperCase(),
        name: name.trim(),
        category,
        partBrand: partBrand.trim(),
        vehicleBrand: vehicleBrand.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleYear: Number(vehicleYear),
        vehicleVersion: vehicleVersion.trim(),
        price: Number(price),
        stock: Number(stock),
        description: description.trim(),
        image: editProduct && !imageFile ? image : '',
      };

      if (editProduct) {
        productPayload.id = editProduct.id;
      }

      await onSave(productPayload, imageFile);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al guardar el producto.');
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '800px' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}></span>
            {editProduct ? 'Editar Ficha de Repuesto' : 'Registro Manual 1:1'}
          </h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: '1.5rem 2rem' }}>
            {error && (
              <div className="auth-error" style={{ marginBottom: '1.5rem' }}>
                {error}
              </div>
            )}

            {/* SECCIÓN 1: IDENTIFICACIÓN DEL REPUESTO (VIOLETA) */}
            <div className="form-section-card" style={{ borderLeft: '4px solid hsl(var(--primary))' }}>
              <div className="form-section-header primary">
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'hsl(var(--primary))' }}></span>
                Identificación y Clasificación del Repuesto
              </div>
              <div className="form-section-grid">
                <div className="form-group">
                  <label className="form-label">SKU <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej: BOS-SPK-FR7DC"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    disabled={!!editProduct}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Código OEM (Fabricante)</label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej: 0242235666"
                    value={oem}
                    onChange={(e) => setOem(e.target.value)}
                  />
                </div>

                <div className="form-group form-section-grid-full">
                  <label className="form-label">Nombre Comercial del Artículo <span style={{ color: 'hsl(var(--danger))' }}>*</span> (Max 150)</label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej: Bujía de Encendido Super Plus"
                    maxLength={150}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Categoría de Catálogo <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <select
                    className="form-control focus-primary"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{ appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2364748b\' stroke-width=\'2\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1.1rem' }}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Marca del Fabricante / Repuesto <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="text"
                    className="form-control focus-primary"
                    placeholder="Ej: Bosch"
                    value={partBrand}
                    onChange={(e) => setPartBrand(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {/* SECCIÓN 2: COMPATIBILIDAD VEHÍCULO (CIAN) */}
            <div className="form-section-card" style={{ borderLeft: '4px solid hsl(var(--accent))' }}>
              <div className="form-section-header accent">
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'hsl(var(--accent))' }}></span>
                Compatibilidad del Vehículo
              </div>
              <div className="form-section-grid">
                <div className="form-group">
                  <label className="form-label">Marca del Automóvil <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="text"
                    className="form-control focus-accent"
                    placeholder="Ej: Toyota"
                    value={vehicleBrand}
                    onChange={(e) => setVehicleBrand(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Modelo del Automóvil <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="text"
                    className="form-control focus-accent"
                    placeholder="Ej: Yaris"
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Año del Modelo <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="number"
                    className="form-control focus-accent"
                    placeholder="Ej: 2018"
                    value={vehicleYear}
                    onChange={(e) => setVehicleYear(Number(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Versión / Motorización <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="text"
                    className="form-control focus-accent"
                    placeholder="Ej: 1.5 GLI"
                    value={vehicleVersion}
                    onChange={(e) => setVehicleVersion(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {/* SECCIÓN 3: INVENTARIO Y VALORES (VERDE EMERALDA) */}
            <div className="form-section-card" style={{ borderLeft: '4px solid hsl(var(--success))' }}>
              <div className="form-section-header success">
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'hsl(var(--success))' }}></span>
                Valores e Inventariado
              </div>
              <div className="form-section-grid">
                <div className="form-group">
                  <label className="form-label">Precio Unitario ($ CLP) <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="number"
                    className="form-control focus-success"
                    placeholder="Ej: 4500"
                    value={price || ''}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Stock Disponible <span style={{ color: 'hsl(var(--danger))' }}>*</span></label>
                  <input
                    type="number"
                    className="form-control focus-success"
                    placeholder="Unidades"
                    value={stock}
                    onChange={(e) => setStock(Number(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group form-section-grid-full">
                  <label className="form-label">Descripción Técnica del Artículo</label>
                  <textarea
                    className="form-control focus-success"
                    placeholder="Detalla las especificaciones de ajuste, material, o vida útil..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    style={{ resize: 'vertical' }}
                  />
                </div>

                <div className="form-group form-section-grid-full">
                  <label className="form-label">Fotografía de Referencia</label>
                  <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                    {imagePreview ? (
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <img
                          src={resolveImageUri(imagePreview)}
                          alt="Vista previa"
                          style={{ width: '80px', height: '80px', borderRadius: '12px', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                        />
                        <button
                          type="button"
                          className="btn-icon"
                          style={{ position: 'absolute', top: -8, right: -8, background: 'var(--danger-bg)', color: 'hsl(var(--danger))', borderRadius: '50%', width: '22px', height: '22px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => {
                            setImage('');
                            setImagePreview('');
                            setImageFile(null);
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{ width: '80px', height: '80px', borderRadius: '12px', border: '2px dashed var(--text-muted)', display: 'flex', alignItems: 'center', color: 'var(--text-muted)', justifyContent: 'center', flexShrink: 0 }}
                      >
                        <ImageIcon size={24} />
                      </div>
                    )}

                    <label className="form-control-file" style={{ flexGrow: 1 }}>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={handleImageChange}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}>
                        <Upload size={16} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Cargar Imagen (Máx 2MB)</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer" style={{ padding: '1rem 2rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : editProduct ? 'Actualizar Repuesto' : 'Guardar Repuesto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
