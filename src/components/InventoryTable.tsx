import React, { useState, useMemo } from 'react';
import { Edit2, Trash2, EyeOff, ChevronLeft, ChevronRight, PauseCircle, PlayCircle } from 'lucide-react';
import type { Product } from '../db';

interface InventoryTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onTogglePause: (product: Product) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({ products, onEdit, onDelete, onTogglePause }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);

  const totalPages = Math.ceil(products.length / itemsPerPage);
  
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return products.slice(start, end);
  }, [products, currentPage]);

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
              {paginatedProducts.map((p) => (
                <tr key={p.id} style={p.pausado ? { opacity: 0.62, background: 'var(--bg-app)' } : undefined}>
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
                  <td className="col-price">{formatCLP(p.price)}</td>
                  <td>{getStockBadge(p.stock)}</td>
                  <td>
                    <span className={`badge ${p.pausado ? 'badge-warning' : 'badge-success'}`}>
                      {p.pausado ? 'Pausado' : 'Publicado'}
                    </span>
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-icon"
                        onClick={() => onEdit(p)}
                        title="Editar Repuesto"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => onTogglePause(p)}
                        title={p.pausado ? 'Retomar publicación' : 'Bloquear publicación'}
                      >
                        {p.pausado ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                      </button>
                      <button
                        className="btn-icon btn-icon-danger"
                        onClick={() => {
                          if (window.confirm(`¿Estás seguro que deseas eliminar el repuesto SKU: ${p.sku}?`)) {
                            onDelete(p.id);
                          }
                        }}
                        title="Eliminar Repuesto"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
