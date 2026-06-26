import React from 'react';
import { Package, Archive, AlertTriangle, RefreshCw } from 'lucide-react';
import type { Product } from '../db';

interface KPIsProps {
  products: Product[];
  lastUpdated: string | null;
}

export const KPIs: React.FC<KPIsProps> = ({ products, lastUpdated }) => {
  const totalActive = products.length;
  
  const totalStock = products.reduce((acc, curr) => acc + (curr.stock || 0), 0);
  
  const outOfStock = products.filter(p => (p.stock || 0) === 0).length;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return { date: 'Sin registros', time: '--:--:--' };
    const date = new Date(dateStr);
    const datePart = date.toLocaleDateString('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const timePart = date.toLocaleTimeString('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return { date: datePart, time: timePart };
  };

  const formattedUpdate = formatDate(lastUpdated);

  return (
    <div className="kpis-grid">
      <div className="card kpi-card">
        <div className="kpi-header">
          <span className="kpi-label">Productos activos</span>
          <div className="kpi-icon primary">
            <Package size={16} />
          </div>
        </div>
        <div className="kpi-body">
          <div className="kpi-value">{totalActive}</div>
          <div className="kpi-trend" style={{ color: 'hsl(var(--primary))' }}>SKUs únicos</div>
        </div>
      </div>

      <div className="card kpi-card">
        <div className="kpi-header">
          <span className="kpi-label">Stock total disponible</span>
          <div className="kpi-icon accent">
            <Archive size={16} />
          </div>
        </div>
        <div className="kpi-body">
          <div className="kpi-value">{totalStock.toLocaleString()}</div>
          <div className="kpi-trend" style={{ color: 'hsl(var(--accent))' }}>Unidades físicas</div>
        </div>
      </div>

      <div className="card kpi-card">
        <div className="kpi-header">
          <span className="kpi-label">Productos sin stock</span>
          <div className="kpi-icon warning">
            <AlertTriangle size={16} />
          </div>
        </div>
        <div className="kpi-body">
          <div className="kpi-value" style={{ color: outOfStock > 0 ? 'hsl(var(--warning))' : 'inherit' }}>
            {outOfStock}
          </div>
          <div className="kpi-trend" style={{ color: outOfStock > 0 ? 'hsl(var(--warning))' : 'var(--text-secondary)' }}>
            {outOfStock > 0 ? 'Requiere reposición' : 'Stock al día'}
          </div>
        </div>
      </div>

      <div className="card kpi-card">
        <div className="kpi-header">
          <span className="kpi-label">Última actualización</span>
          <div className="kpi-icon success">
            <RefreshCw size={16} />
          </div>
        </div>
        <div className="kpi-body">
          <div className="kpi-value" style={{ fontSize: '1.15rem', marginTop: '0.45rem' }}>
            {formattedUpdate.date}
          </div>
          <div className="kpi-trend" style={{ color: 'hsl(var(--success))' }}>
            {formattedUpdate.time}
          </div>
        </div>
      </div>
    </div>
  );
};
