import React, { useState, useMemo } from 'react';
import { Edit2, Trash2, EyeOff, ChevronLeft, ChevronRight, PauseCircle, PlayCircle, Check, X, Loader2, Star } from 'lucide-react';
import type { Product } from '../db';
import { getProductTopStatus, topLabel } from '../utils/productTop';
import { ETIQUETAS_GRUPO, type GrupoInventario } from '../utils/inventoryOrder';
import topVentasBadge from '../assets/top-ventas-badge-transparent.png';

interface InventoryTableProps {
  products: Product[];
  /**
   * A qué grupo del orden recomendado pertenece cada producto, para dibujar los separadores.
   * Sin esto la tabla se comporta como siempre: una lista corrida, sin encabezados.
   */
  grupos?: Map<string, GrupoInventario>;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onTogglePause: (product: Product) => void;
  onManageTop?: (product: Product) => void;
  onQuickUpdate?: (product: Product, updates: { price?: number; stock?: number }) => Promise<void>;
}

interface QuickEditCellProps {
  product: Product;
  field: 'price' | 'stock';
  onSave?: (product: Product, updates: { price?: number; stock?: number }) => Promise<void>;
  renderDisplay: () => React.ReactNode;
}

const QuickEditCell: React.FC<QuickEditCellProps> = ({ product, field, onSave, renderDisplay }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState<string>(String(field === 'price' ? product.price : product.stock));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(String(field === 'price' ? product.price : product.stock));
    setErrorMsg(null);
    setIsEditing(true);
  };

  const handleCancel = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsEditing(false);
    setErrorMsg(null);
  };

  const handleConfirm = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!onSave) return;

    const numericValue = Number(value);
    if (Number.isNaN(numericValue) || numericValue < 0) {
      setErrorMsg(field === 'price' ? 'Precio inválido' : 'Stock inválido');
      return;
    }

    if (field === 'price' && numericValue === product.price) {
      setIsEditing(false);
      return;
    }
    if (field === 'stock' && numericValue === product.stock) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onSave(product, { [field]: numericValue });
      setIsEditing(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al actualizar');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (!isEditing || !onSave) {
    return (
      <div
        className="quick-edit-display-wrapper"
        onClick={onSave ? handleStartEdit : undefined}
        title={onSave ? `Clic para editar ${field === 'price' ? 'precio' : 'stock'}` : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          cursor: onSave ? 'pointer' : 'default',
          borderRadius: '6px',
          padding: '0.2rem 0.4rem',
          transition: 'background 0.15s ease',
        }}
      >
        {renderDisplay()}
        {onSave && (
          <button
            type="button"
            className="quick-edit-btn"
            aria-label={`Editar ${field === 'price' ? 'precio' : 'stock'}`}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px',
              cursor: 'pointer',
              opacity: 0.4,
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--text-secondary)'
            }}
          >
            <Edit2 size={12} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="quick-edit-form"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.2rem'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        {field === 'price' && <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>$</span>}
        <input
          type="number"
          min={0}
          step={field === 'price' ? 100 : 1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          disabled={isSaving}
          style={{
            width: field === 'price' ? '90px' : '65px',
            padding: '0.25rem 0.4rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            borderRadius: '6px',
            border: errorMsg ? '1px solid hsl(var(--danger))' : '1px solid hsl(var(--primary))',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            outline: 'none'
          }}
        />
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSaving}
          title="Guardar"
          aria-label="Guardar"
          style={{
            background: 'hsl(var(--success))',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '0.3rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {isSaving ? <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSaving}
          title="Cancelar"
          aria-label="Cancelar"
          style={{
            background: 'var(--bg-app)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '0.3rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <X size={14} />
        </button>
      </div>
      {errorMsg && (
        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--danger))', fontWeight: 600 }}>
          {errorMsg}
        </span>
      )}
    </div>
  );
};

export const InventoryTable: React.FC<InventoryTableProps> = ({ products, grupos, onEdit, onDelete, onTogglePause, onManageTop, onQuickUpdate }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);

  const totalPages = Math.ceil(products.length / itemsPerPage);
  
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return products.slice(start, end);
  }, [products, currentPage, itemsPerPage]);

  /**
   * Dónde va cada separador de grupo dentro de la página que se está mostrando.
   *
   * Se calcula por página y no sobre la lista entera: la primera fila de la página SIEMPRE lleva
   * su encabezado, aunque su grupo haya empezado en la página anterior. Sin eso, la página 2 de
   * "Resto del inventario" aparecería sin decir qué es.
   */
  const separadores = useMemo(() => {
    if (!grupos) return new Map<string, GrupoInventario>();
    const marcas = new Map<string, GrupoInventario>();
    let anterior: GrupoInventario | null = null;
    paginatedProducts.forEach((product, indice) => {
      const grupo = grupos.get(product.id);
      if (!grupo) return;
      if (indice === 0 || grupo !== anterior) marcas.set(product.id, grupo);
      anterior = grupo;
    });
    return marcas;
  }, [grupos, paginatedProducts]);

  const getStockBadge = (stock: number) => {
    if (stock === 0) {
      return <span className="badge badge-danger">Sin Stock</span>;
    } else if (stock < 10) {
      return <span className="badge badge-warning">{stock} unid.</span>;
    } else {
      return <span className="badge badge-success">{stock} unid.</span>;
    }
  };

  const formatCLP = (price: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0
    }).format(price);
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="table-container">
        {products.length === 0 ? (
          <div className="empty-state">
            <EyeOff size={48} className="empty-state-icon" />
            <h3>No se encontraron repuestos</h3>
            <p>Intenta ajustar los criterios de búsqueda o agrega un nuevo producto.</p>
          </div>
        ) : (
          <table className="inventory-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>OEM</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Marca Rep.</th>
                <th>Vehículo (Compatibilidad)</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.map((p) => {
                const topStatus = getProductTopStatus(p);
                const separador = separadores.get(p.id);
                return <React.Fragment key={p.id}>
                {separador && <tr className={`inventory-group-row is-${separador}`}>
                  <th colSpan={10} scope="colgroup">{ETIQUETAS_GRUPO[separador]}</th>
                </tr>}
                <tr className={topStatus.state === 'active' ? 'inventory-row-top' : topStatus.state === 'expired' ? 'inventory-row-top-expired' : ''} style={p.pausado ? { opacity: 0.62, background: 'var(--bg-app)' } : undefined}>
                  <td className="col-sku" title={p.sku}>
                    {p.sku}
                  </td>
                  <td className="col-id" title={p.oem || 'N/A'}>
                    {p.oem || 'N/A'}
                  </td>
                  <td style={{ fontWeight: 600, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                    {p.name}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', background: 'var(--bg-app)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                      {p.category}
                    </span>
                  </td>
                  <td>{p.partBrand}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600 }}>{p.vehicleBrand} {p.vehicleModel}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {p.vehicleYear} - {p.vehicleVersion}
                      </span>
                    </div>
                  </td>
                  <td className="col-price">
                    <QuickEditCell
                      product={p}
                      field="price"
                      onSave={onQuickUpdate}
                      renderDisplay={() => formatCLP(p.price)}
                    />
                  </td>
                  <td>
                    <QuickEditCell
                      product={p}
                      field="stock"
                      onSave={onQuickUpdate}
                      renderDisplay={() => getStockBadge(p.stock)}
                    />
                  </td>
                  <td>
                    <span className={`badge ${p.pausado ? 'badge-warning' : 'badge-success'}`}>
                      {p.pausado ? 'Pausado' : 'Publicado'}
                    </span>
                    {topLabel(topStatus) && <span className={`top-table-badge ${topStatus.state === 'expired' ? 'expired' : ''}`}><img src={topVentasBadge} alt="Insignia Top Ventas" />{topLabel(topStatus)}</span>}
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button
                        type="button"
                        className={`action-btn action-btn-top ${topStatus.state === 'active' ? 'active' : ''}`}
                        onClick={() => onManageTop?.(p)}
                        title={topStatus.state === 'active' ? 'Renovar producto Top' : 'Marcar como producto Top'}
                        aria-label={topStatus.state === 'active' ? 'Renovar producto Top' : 'Marcar como producto Top'}
                      >
                        <Star size={16} fill={topStatus.state === 'active' ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        className="action-btn action-btn-edit"
                        onClick={() => onEdit(p)}
                        title="Editar repuesto completo"
                        aria-label="Editar repuesto completo"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        className={`action-btn ${p.pausado ? 'action-btn-play' : 'action-btn-pause'}`}
                        onClick={() => onTogglePause(p)}
                        title={p.pausado ? 'Reactivar publicación' : 'Pausar publicación'}
                        aria-label={p.pausado ? 'Reactivar publicación' : 'Pausar publicación'}
                      >
                        {p.pausado ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                      </button>
                      <button
                        type="button"
                        className="action-btn action-btn-danger"
                        onClick={() => {
                          if (window.confirm(`¿Estás seguro que deseas eliminar el repuesto SKU: ${p.sku}?`)) {
                            onDelete(p.id);
                          }
                        }}
                        title="Eliminar repuesto"
                        aria-label="Eliminar repuesto"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
                </React.Fragment>;
              })}
            </tbody>
          </table>
        )}
      </div>

      {products.length > 0 && (
        <div className="pagination">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              Mostrando <strong>{((currentPage - 1) * itemsPerPage) + 1}</strong> a{' '}
              <strong>{Math.min(currentPage * itemsPerPage, products.length)}</strong> de{' '}
              <strong>{products.length}</strong> productos.
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span>Mostrar:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              >
                <option value={5}>5</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>por pág.</span>
            </div>
          </div>
          <div className="pagination-buttons">
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev) => prev - 1)}
            >
              <ChevronLeft size={16} />
              Anterior
            </button>
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 1rem', fontWeight: 600 }}>
              Pág. {currentPage} de {totalPages || 1}
            </span>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage((prev) => prev + 1)}
            >
              Siguiente
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
