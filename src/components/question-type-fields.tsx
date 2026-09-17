"use client";

import { useState } from "react";
import { QUESTION_TYPE_LABELS, type QuestionType } from "@/lib/types";

type Props = { defaultType: QuestionType; defaultMin?: number; defaultMax?: number };

export function QuestionTypeFields({ defaultType, defaultMin = 1, defaultMax = 5 }: Props) {
  const [type, setType] = useState<QuestionType>(defaultType);
  return (
    <>
      <select className="field" name="type" value={type} onChange={(event) => setType(event.target.value as QuestionType)}>
        {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      {type === "rating" && <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Rating min</label><input className="field" name="ratingMin" type="number" min={0} max={9} defaultValue={defaultMin} /></div>
        <div><label className="label">Rating max</label><input className="field" name="ratingMax" type="number" min={1} max={10} defaultValue={defaultMax} /></div>
      </div>}
    </>
  );
}
