---
paths:
  - "src/*/Domain/Model/*.php"
exclude:
  - "**/*Trait.php"
  - "**/*Interface.php"
---

# Constraints — Doctrine entities

Scope: `src/*/Domain/Model/*.php` carrying `class of the Domain\Model namespace mapped by Doctrine attributes (#[ORM\Entity] or #[ORM\Embeddable])`.

## Static Rules

```rules
ENT-001 | present | #\[ORM\\Table\(name: '[a-z0-9_]+'\)\] | MUST An entity explicitly names its table in snake_case | gate=#\[ORM\\Entity
ENT-002 | absent | #\[ORM\\Entity\(repositoryClass | MUST NOT An entity does not declare a repositoryClass in its ORM attribute | gate=#\[ORM\\Entity
ENT-003 | present | ^\s+use IdentityTrait; | MUST An entity gets its identifier from IdentityTrait rather than from a local #[ORM\Id] property | gate=#\[ORM\\Entity
ENT-012 | absent | #\[ORM\\UniqueConstraint\((?!name: ') | MUST A class-level unique constraint carries an explicit name | gate=#\[ORM\\UniqueConstraint\(
ENT-013 | absent | (public|private|protected)[^(]*\$(createdAt|updatedAt)\b | MUST NOT An entity does not declare its own createdAt/updatedAt columns: they come from TimestampableTrait | gate=#\[ORM\\Entity
```

## Semantic Rules

- MUST: An entity using SoftDeleteableTrait declares the Gedmo\SoftDeleteable attribute on deletedAt. Trigger: entity composed with SoftDeleteableTrait. Anchor: #[Gedmo\SoftDeleteable(fieldName: 'deletedAt', timeAware: false, hardDelete: false)] on the class. (3/3)
- MUST: A mapped property readable from outside is declared public private(set), without a getter. Trigger: mapped property of an entity consumed outside the entity. Anchor: public private(set) modifier on the property declaration. (15/16)
- MUST: An #[ORM\Embedded] explicitly sets its columnPrefix. Trigger: property mapped by #[ORM\Embedded]. Anchor: columnPrefix argument (false or a snake_case prefix) in the Embedded attribute. (4/4)
- MUST: A ManyToOne association declares an #[ORM\JoinColumn] carrying its nullability. Trigger: property annotated #[ORM\ManyToOne]. Anchor: #[ORM\JoinColumn(nullable: ...)] on the next line. (8/8)
- MUST: An association attribute names targetEntity as its first argument. Trigger: #[ORM\ManyToOne], #[ORM\OneToMany], #[ORM\ManyToMany] or #[ORM\OneToOne] attribute. Anchor: targetEntity: X::class right after the opening parenthesis. — coherence, non-blocking (10/10)
- MUST: A phone number is typed by the Phone value object and mapped with the phone Doctrine type. Trigger: entity property holding a phone number. Anchor: #[ORM\Column(type: 'phone', length: 20)] above a property typed Phone. (4/4)
- MUST: A forbidden status transition throws a \LogicException from the entity. Trigger: entity method changing a status property mapped by enumType. Anchor: guard on the current status followed by throw new \LogicException. (4/4)
