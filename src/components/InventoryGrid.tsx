import { Fragment } from 'react';
import { Edit2, EyeOff, PauseCircle, PlayCircle, Star, Trash2 } from 'lucide-react';
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

export function InventoryGrid({ products, grupos, onEdit, onDelete, onTogglePause, onManageTop }: InventoryGridProps) {
  if (products.length === 0) return <div className="card inventory-grid-empty"><EyeOff size={42} /><h3>No se encontraron repuestos</h3><p>Prueba ajustando los filtros o agrega un producto.</p></div>;
  return <div className="inventory-grid" aria-label="Inventario en cuadrícula">
    {products.map((product, indice) => {
      const topStatus = getProductTopStatus(product);
      const grupo = grupos?.get(product.id);
      // El primero SIEMPRE lleva su encabezado; después, solo cuando cambia el grupo.
      const separador = grupo && (indice === 0 || grupos?.get(products[indice - 1].id) !== grupo) ? grupo : null;
      return <Fragment key={product.id}>
      {separador && <h2 className={`inventory-group-heading is-${separador}`}>{ETIQUETAS_GRUPO[separador]}</h2>}
      <article className={`inventory-grid-card ${topStatus.state === 'active' ? 'is-top' : ''} ${product.pausado ? 'is-paused' : ''}`}>
        <div className="inventory-grid-image"><img src={resolveImageUri(product.image)} alt={product.name} />{topStatus.state !== 'none' && <div className={`grid-top-badge ${topStatus.state === 'expired' ? 'expired' : ''}`}><img src={topVentasBadge} alt="" /><span>{topLabel(topStatus)}</span></div>}{product.pausado && <span className="grid-paused">Pausado</span>}</div>
        <div className="inventory-grid-content"><span className="grid-sku">SKU {product.sku || '—'}</span><h3 title={product.name}>{product.name}</h3><div className="grid-details"><span>{product.stock === 0 ? 'Sin stock' : `${product.stock} unidades`}</span><strong>{clp(product.price)}</strong></div></div>
        <footer className="inventory-grid-actions"><button type="button" className="grid-action" onClick={() => onEdit(product)} title="Editar repuesto" aria-label={`Editar ${product.name}`}><Edit2 size={16} /></button><button type="button" className="grid-action grid-action-top" onClick={() => onManageTop(product)} title="Gestionar producto Top" aria-label={`Gestionar Top: ${product.name}`}><Star size={16} fill={topStatus.state === 'active' ? 'currentColor' : 'none'} /></button><button type="button" className="grid-action" onClick={() => onTogglePause(product)} title={product.pausado ? 'Reactivar publicación' : 'Pausar publicación'} aria-label={product.pausado ? `Reactivar ${product.name}` : `Pausar ${product.name}`}>{product.pausado ? <PlayCircle size={16} /> : <PauseCircle size={16} />}</button><button type="button" className="grid-action grid-action-danger" onClick={() => { if (window.confirm(`¿Estás seguro que deseas eliminar el repuesto SKU: ${product.sku}?`)) onDelete(product.id); }} title="Eliminar repuesto" aria-label={`Eliminar ${product.name}`}><Trash2 size={16} /></button></footer>
      </article>
      </Fragment>;
    })}
  </div>;
}
