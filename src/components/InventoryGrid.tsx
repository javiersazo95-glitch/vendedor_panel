import { Fragment, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Edit2, EyeOff, PauseCircle, PlayCircle, Star, Trash2 } from 'lucide-react';
import type { Product } from '../db';
import topVentasBadge from '../assets/top-ventas-badge-transparent.png';
import { getProductTopStatus, topLabel } from '../utils/productTop';
import { ETIQUETAS_GRUPO, type GrupoInventario } from '../utils/inventoryOrder';
import { resolveImageUri } from '../utils/imageHelper';

interface InventoryGridProps {
  products: Product[];
  /**
   * A qué grupo del orden recomendado pertenece cada producto. Los separadores ocupan la fila
   * entera de la grilla, o quedarían como una tarjeta más entre los repuestos.
   */
  grupos?: Map<string, GrupoInventario>;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onTogglePause: (product: Product) => void;
  onManageTop: (product: Product) => void;
}

const clp = (price: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(price);

/**
 * Tarjetas por página. La grilla tiene 4 columnas en escritorio (index.css,
 * .inventory-grid), así que se usan múltiplos de 4: la última fila queda completa en vez
 * de con un hueco a mitad de fila.
 */
const ITEMS_PER_PAGE_OPCIONES = [12, 20, 40, 80] as const;

export function InventoryGrid({ products, grupos, onEdit, onDelete, onTogglePause, onManageTop }: InventoryGridProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(20);

  const totalPages = Math.ceil(products.length / itemsPerPage);

  // Sin esto, un catálogo de miles de repuestos monta una tarjeta -con su imagen, sus
  // cuatro botones y su título- por cada uno de una sola vez: miles de <img> pidiéndose
  // al mismo tiempo y el navegador tildándose al hacer scroll. Mismo patrón que ya usa
  // InventoryTable, para que el vendedor no aprenda un comportamiento distinto por vista.
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return products.slice(start, start + itemsPerPage);
  }, [products, currentPage, itemsPerPage]);

  /**
   * Dónde va cada separador de grupo dentro de la página que se está mostrando.
   *
   * Se calcula por página y no sobre la lista entera: la primera tarjeta de la página
   * SIEMPRE lleva su encabezado, aunque su grupo haya empezado en la página anterior. Sin
   * eso, la página 2 de "Resto del inventario" aparecería sin decir qué es (igual que en
   * InventoryTable).
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

  if (products.length === 0) return <div className="card inventory-grid-empty"><EyeOff size={42} /><h3>No se encontraron repuestos</h3><p>Prueba ajustando los filtros o agrega un producto.</p></div>;

  return <>
    <div className="inventory-grid" aria-label="Inventario en cuadrícula">
      {paginatedProducts.map((product) => {
        const topStatus = getProductTopStatus(product);
        const separador = separadores.get(product.id);
        return <Fragment key={product.id}>
        {separador && <h2 className={`inventory-group-heading is-${separador}`}>{ETIQUETAS_GRUPO[separador]}</h2>}
        <article className={`inventory-grid-card ${topStatus.state === 'active' ? 'is-top' : ''} ${product.pausado ? 'is-paused' : ''}`}>
          <div className="inventory-grid-image"><img src={resolveImageUri(product.image)} alt={product.name} />{topStatus.state !== 'none' && <div className={`grid-top-badge ${topStatus.state === 'expired' ? 'expired' : ''}`}><img src={topVentasBadge} alt="" /><span>{topLabel(topStatus)}</span></div>}{product.pausado && <span className="grid-paused">Pausado</span>}</div>
          <div className="inventory-grid-content"><span className="grid-sku">SKU {product.sku || '—'}</span><h3 title={product.name}>{product.name}</h3><div className="grid-details"><span>{product.stock === 0 ? 'Sin stock' : `${product.stock} unidades`}</span><strong>{clp(product.price)}</strong></div></div>
          <footer className="inventory-grid-actions"><button type="button" className="grid-action" onClick={() => onEdit(product)} title="Editar repuesto" aria-label={`Editar ${product.name}`}><Edit2 size={16} /></button><button type="button" className="grid-action grid-action-top" onClick={() => onManageTop(product)} title="Gestionar producto Top" aria-label={`Gestionar Top: ${product.name}`}><Star size={16} fill={topStatus.state === 'active' ? 'currentColor' : 'none'} /></button><button type="button" className="grid-action" onClick={() => onTogglePause(product)} title={product.pausado ? 'Reactivar publicación' : 'Pausar publicación'} aria-label={product.pausado ? `Reactivar ${product.name}` : `Pausar ${product.name}`}>{product.pausado ? <PlayCircle size={16} /> : <PauseCircle size={16} />}</button><button type="button" className="grid-action grid-action-danger" onClick={() => { if (window.confirm(`¿Estás seguro que deseas eliminar el repuesto SKU: ${product.sku}?`)) onDelete(product.id); }} title="Eliminar repuesto" aria-label={`Eliminar ${product.name}`}><Trash2 size={16} /></button></footer>
        </article>
        </Fragment>;
      })}
    </div>

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
            {ITEMS_PER_PAGE_OPCIONES.map((opcion) => <option key={opcion} value={opcion}>{opcion}</option>)}
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
  </>;
}
