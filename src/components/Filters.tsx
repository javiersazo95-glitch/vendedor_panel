import React, { useMemo } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import type { Product } from '../db';

interface FiltersProps {
  products: Product[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  categoryFilter: string;
  setCategoryFilter: (c: string) => void;
  partBrandFilter: string;
  setPartBrandFilter: (b: string) => void;
  vehicleBrandFilter: string;
  setVehicleBrandFilter: (b: string) => void;
  yearFilter: string;
  setYearFilter: (y: string) => void;
  onClearFilters: () => void;
}

export const Filters: React.FC<FiltersProps> = ({
  products,
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  partBrandFilter,
  setPartBrandFilter,
  vehicleBrandFilter,
  setVehicleBrandFilter,
  yearFilter,
  setYearFilter,
  onClearFilters,
}) => {
  // Extract unique options dynamically from products catalog
  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const partBrands = useMemo(() => {
    const set = new Set(products.map((p) => p.partBrand).filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const vehicleBrands = useMemo(() => {
    const set = new Set(products.map((p) => p.vehicleBrand).filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const vehicleYears = useMemo(() => {
    const set = new Set(products.map((p) => p.vehicleYear).filter(Boolean));
    return Array.from(set).sort((a, b) => b - a); // Descending order
  }, [products]);

  const isAnyFilterActive = searchQuery || categoryFilter || partBrandFilter || vehicleBrandFilter || yearFilter;

  return (
    <div className="card control-bar-single-row" id="filters-container">
      {/* Search Input */}
      <div className="search-input-wrapper-single" id="search-wrapper">
        <Search size={14} className="search-icon-single" />
        <input
          type="text"
          className="search-input-single"
          placeholder="Buscar por SKU, Nombre o OEM..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          id="search-input-field"
        />
      </div>

      {/* Dropdown Filters */}
      <select
        className="select-filter-single"
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        id="filter-category"
      >
        <option value="">Categoría: Todas</option>
        {categories.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>

      <select
        className="select-filter-single"
        value={partBrandFilter}
        onChange={(e) => setPartBrandFilter(e.target.value)}
        id="filter-part-brand"
      >
        <option value="">Marca: Todas</option>
        {partBrands.map((brand) => (
          <option key={brand} value={brand}>
            {brand}
          </option>
        ))}
      </select>

      <select
        className="select-filter-single"
        value={vehicleBrandFilter}
        onChange={(e) => setVehicleBrandFilter(e.target.value)}
        id="filter-vehicle-brand"
      >
        <option value="">Vehículo: Todos</option>
        {vehicleBrands.map((brand) => (
          <option key={brand} value={brand}>
            {brand}
          </option>
        ))}
      </select>

      <select
        className="select-filter-single"
        value={yearFilter}
        onChange={(e) => setYearFilter(e.target.value)}
        id="filter-year"
      >
        <option value="">Año: Todos</option>
        {vehicleYears.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>

      {isAnyFilterActive && (
        <button
          onClick={onClearFilters}
          className="btn btn-secondary btn-single-row"
          title="Limpiar filtros"
          id="btn-clear-filters"
        >
          <RotateCcw size={14} />
          Limpiar
        </button>
      )}
    </div>
  );
};
