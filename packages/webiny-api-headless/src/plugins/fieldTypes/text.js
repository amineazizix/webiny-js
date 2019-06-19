// @flow
import type { HeadlessFieldTypePlugin } from "webiny-api-headless/types";

export default ({
    name: "cms-headless-field-type-text",
    type: "cms-headless-field-type",
    fieldType: "text",
    /*createAttribute({ field, entity, context }) {
        if (!field.i18n) {
            entity
                .attr(field.fieldId)
                .char()
                .setValidators(createValidator({ field, entity, context }));
            return;
        }

        class TextValueModel extends Model {
            constructor() {
                super();

                this.attr("locale").char();
                this.attr("value")
                    .char()
                    .setValidators(createValidator({ field, entity, context }));
            }
        }

        entity
            .attr(field.fieldId)
            .models(TextValueModel)
            .onSet(newValue => {
                /!* $FlowFixMe *!/
                const currentValue = entity.getAttribute(field.fieldId).getValue();
                if (Array.isArray(currentValue) && currentValue.length > 0) {
                    const mergedValue = currentValue.map(model => ({
                        /!* $FlowFixMe *!/
                        value: model.value,
                        /!* $FlowFixMe *!/
                        locale: model.locale
                    }));

                    newValue.forEach(({ value, locale }) => {
                        const index = mergedValue.findIndex(v => v.locale === locale);
                        if (index === -1) {
                            mergedValue.push({ value, locale });
                        } else {
                            mergedValue[index].value = value;
                        }
                    });

                    return mergedValue;
                }
                return newValue;
            });
    },*/
    read: {
        createTypeField({ field }) {
            return `${field.fieldId}: String`;
        },
        createResolver({ field }) {
            return (entity, args, context, { fieldName }) => {
                if (field.i18n === false) {
                    return entity[fieldName];
                }

                const i18n = entity[fieldName].reduce((acc, v) => {
                    acc[v.locale] = v.value;
                    return acc;
                }, {});

                return i18n[context.locale] || i18n[context.defaultLocale];
            };
        }
    },
    manage: {
        createTypes() {
            return /* GraphQL */ `
                type Manage_HeadlessText {
                    locale: String
                    value: String
                }

                input Manage_HeadlessTextInput {
                    locale: String!
                    value: String!
                }
            `;
        },
        createTypeField({ field }) {
            if (field.i18n) {
                return field.fieldId + ": [Manage_HeadlessText]";
            }
            return field.fieldId + ": String";
        },
        createInputField({ field }) {
            if (field.i18n) {
                return field.fieldId + ": [Manage_HeadlessTextInput]";
            }
            return field.fieldId + ": String";
        }
    }
}: HeadlessFieldTypePlugin);
