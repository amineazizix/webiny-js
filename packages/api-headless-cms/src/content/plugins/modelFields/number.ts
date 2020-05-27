import { CmsModelFieldToCommodoFieldPlugin } from "@webiny/api-headless-cms/types";
import { withFields, number } from "@webiny/commodo";
import { i18nField } from "./i18nFields";

const plugin: CmsModelFieldToCommodoFieldPlugin = {
    name: "cms-model-field-to-commodo-field-number",
    type: "cms-model-field-to-commodo-field",
    fieldType: "number",
    dataModel({ model, field, validation, context }) {
        return withFields({
            [field.fieldId]: i18nField({
                field: number({ validation, list: field.multipleValues }),
                context
            })
        })(model);
    },
    searchModel({ model, field, validation }) {
        // Searching multiple-value fields is not supported.
        if (field.multipleValues) {
            return;
        }

        return withFields({
            [field.fieldId]: number({ validation })
        })(model);
    }
};

export default plugin;
