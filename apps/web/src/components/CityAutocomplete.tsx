import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MapPin } from "lucide-react";
import { api } from "../api";
import { Input } from "@/components/ui/input";

export interface MunicipalityOption {
  name: string;
  state: string;
  ibgeCode: string;
}

export function CityAutocomplete() {
  const listId = useId();
  const requestId = useRef(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MunicipalityOption | null>(null);
  const [options, setOptions] = useState<MunicipalityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (selected?.name === query || query.trim().length < 2) {
      requestId.current += 1;
      setOptions([]);
      setOpen(false);
      setLoading(false);
      setSearchError(false);
      return;
    }
    const currentRequest = ++requestId.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setSearchError(false);
      try {
        const result = await api<{ municipalities: MunicipalityOption[] }>(`/api/municipalities?q=${encodeURIComponent(query.trim())}`);
        if (requestId.current !== currentRequest) return;
        setOptions(result.municipalities);
        setOpen(true);
        setActiveIndex(-1);
      } catch {
        if (requestId.current === currentRequest) {
          setOptions([]);
          setSearchError(true);
          setOpen(true);
        }
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, selected]);

  function choose(option: MunicipalityOption) {
    setSelected(option);
    setQuery(option.name);
    setOptions([]);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(options[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return <div className="city-autocomplete">
    <Input
      name="city"
      value={query}
      onChange={(event) => { setQuery(event.target.value); setSelected(null); }}
      onFocus={() => { if (options.length) setOpen(true); }}
      onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      onKeyDown={handleKeyDown}
      placeholder="Digite ao menos 2 letras"
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
    />
    <input type="hidden" name="state" value={selected?.state ?? ""} />
    <input type="hidden" name="municipalityCode" value={selected?.ibgeCode ?? ""} />
    {selected && <span className="city-selected">{selected.state} · município IBGE {selected.ibgeCode}</span>}
    {loading && <span className="city-loading">Buscando…</span>}
    {open && <ul id={listId} role="listbox" className="city-options">
      {options.length ? options.map((option, index) => <li
        id={`${listId}-${index}`}
        role="option"
        aria-selected={index === activeIndex}
        className={index === activeIndex ? "active" : undefined}
        key={option.ibgeCode}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      ><MapPin aria-hidden="true" /><span>{option.name}<small>{option.state} · município IBGE {option.ibgeCode}</small></span></li>) : !loading && <li className="city-empty">{searchError ? "Busca indisponível. Tente novamente." : "Nenhum município encontrado"}</li>}
    </ul>}
  </div>;
}
