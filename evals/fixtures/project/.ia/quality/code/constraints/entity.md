---
paths:
  - "src/*/Domain/Model/*.php"
exclude:
  - "**/*Trait.php"
  - "**/*Interface.php"
---

# Constraints — Entités Doctrine

Scope: `src/*/Domain/Model/*.php` carrying `classe du namespace Domain\Model mappée par attributs Doctrine (#[ORM\Entity] ou #[ORM\Embeddable])`.

## Static Rules

```rules
ENT-001 | present | #\[ORM\\Table\(name: '[a-z0-9_]+'\)\] | MUST Une entité nomme explicitement sa table en snake_case | gate=#\[ORM\\Entity
ENT-002 | absent | #\[ORM\\Entity\(repositoryClass | MUST NOT Une entité ne déclare pas de repositoryClass dans son attribut ORM | gate=#\[ORM\\Entity
ENT-003 | present | ^\s+use IdentityTrait; | MUST Une entité tient son identifiant de IdentityTrait plutôt que d'une propriété #[ORM\Id] locale | gate=#\[ORM\\Entity
ENT-012 | absent | #\[ORM\\UniqueConstraint\((?!name: ') | MUST Une contrainte d'unicité de classe porte un nom explicite | gate=#\[ORM\\UniqueConstraint\(
ENT-013 | absent | (public|private|protected)[^(]*\$(createdAt|updatedAt)\b | MUST NOT Une entité ne déclare pas ses propres colonnes createdAt/updatedAt : elles viennent de TimestampableTrait | gate=#\[ORM\\Entity
```

## Semantic Rules

- MUST: Une entité qui utilise SoftDeleteableTrait déclare l'attribut Gedmo\SoftDeleteable sur deletedAt. Trigger: entité composée avec SoftDeleteableTrait. Anchor: #[Gedmo\SoftDeleteable(fieldName: 'deletedAt', timeAware: false, hardDelete: false)] au niveau de la classe. (3/3)
- MUST: Une propriété mappée lisible de l'extérieur est déclarée public private(set), sans getter. Trigger: propriété mappée d'une entité consommée hors de l'entité. Anchor: modificateur public private(set) sur la déclaration de propriété. (15/16)
- MUST: Un #[ORM\Embedded] fixe explicitement son columnPrefix. Trigger: propriété mappée par #[ORM\Embedded]. Anchor: argument columnPrefix (false ou préfixe snake_case) dans l'attribut Embedded. (4/4)
- MUST: Une association ManyToOne déclare un #[ORM\JoinColumn] portant sa nullabilité. Trigger: propriété annotée #[ORM\ManyToOne]. Anchor: #[ORM\JoinColumn(nullable: ...)] sur la ligne suivante. (8/8)
- MUST: Un attribut d'association nomme targetEntity en premier argument. Trigger: attribut #[ORM\ManyToOne], #[ORM\OneToMany], #[ORM\ManyToMany] ou #[ORM\OneToOne]. Anchor: targetEntity: X::class immédiatement après la parenthèse ouvrante. — coherence, non-blocking (10/10)
- MUST: Un numéro de téléphone est typé par le VO Telephone et mappé avec le type Doctrine telephone. Trigger: propriété d'entité représentant un numéro de téléphone. Anchor: #[ORM\Column(type: 'telephone', length: 20)] au-dessus d'une propriété typée Telephone. (4/4)
- MUST: Une transition de statut interdite lève une \LogicException depuis l'entité. Trigger: méthode d'entité qui fait changer une propriété de statut mappée par enumType. Anchor: garde sur le statut courant suivie de throw new \LogicException. (4/4)
