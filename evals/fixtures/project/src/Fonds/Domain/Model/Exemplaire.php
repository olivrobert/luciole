<?php

declare(strict_types=1);

namespace Fonds\Domain\Model;

use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\ORM\Mapping as ORM;
use Fonds\Domain\Enum\StatutExemplaire;
use Fonds\Domain\Model\Embeddable\Emplacement;
use Mediatheque\Domain\Model\Mediatheque;

#[ORM\Entity]
#[ORM\Table(name: 'exemplaire')]
#[ORM\UniqueConstraint(name: 'uniq_exemplaire_cote', columns: ['cote'])]
class Exemplaire
{
    use IdentityTrait;
    use TimestampableTrait;

    #[ORM\ManyToOne(targetEntity: Ouvrage::class, inversedBy: 'exemplaires')]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Ouvrage $ouvrage;

    #[ORM\ManyToOne(targetEntity: Mediatheque::class)]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Mediatheque $mediatheque;

    #[ORM\Column(length: 32)]
    public private(set) string $cote;

    #[ORM\Embedded(class: Emplacement::class)]
    public private(set) Emplacement $emplacement;

    #[ORM\Column(length: 20, enumType: StatutExemplaire::class)]
    public private(set) StatutExemplaire $statut;

    public function __construct(Ouvrage $ouvrage, Mediatheque $mediatheque, string $cote, Emplacement $emplacement)
    {
        $this->ouvrage = $ouvrage;
        $this->mediatheque = $mediatheque;
        $this->cote = $cote;
        $this->emplacement = $emplacement;
        $this->statut = StatutExemplaire::Disponible;
    }

    public function emprunter(): void
    {
        if (StatutExemplaire::Disponible !== $this->statut) {
            throw new \LogicException('Seul un exemplaire disponible peut être emprunté.');
        }

        $this->statut = StatutExemplaire::Emprunte;
    }

    public function restituer(): void
    {
        if (StatutExemplaire::Emprunte !== $this->statut) {
            throw new \LogicException('Seul un exemplaire emprunté peut être restitué.');
        }

        $this->statut = StatutExemplaire::Disponible;
    }

    public function retirer(): void
    {
        if (StatutExemplaire::Retire === $this->statut) {
            throw new \LogicException('Cet exemplaire est déjà retiré du fonds.');
        }

        $this->statut = StatutExemplaire::Retire;
    }

    public function deplacer(Emplacement $emplacement): void
    {
        $this->emplacement = $emplacement;
    }
}
