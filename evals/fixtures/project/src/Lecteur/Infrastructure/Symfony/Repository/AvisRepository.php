<?php

declare(strict_types=1);

namespace Lecteur\Infrastructure\Symfony\Repository;

use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Fonds\Domain\Model\Ouvrage;
use Lecteur\Domain\Model\Avis;
use Lecteur\Domain\Repository\AvisRepositoryInterface;

/**
 * @extends ServiceEntityRepository<Avis>
 */
class AvisRepository extends ServiceEntityRepository implements AvisRepositoryInterface
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Avis::class);
    }

    public function save(Avis $avis): void
    {
        $this->getEntityManager()->persist($avis);
    }

    public function findById(int $id): ?Avis
    {
        return $this->find($id);
    }

    /**
     * @param array{note?: int, ouvrage?: Ouvrage} $criteres
     *
     * @return list<Avis>
     */
    public function findByCriteres(array $criteres): array
    {
        return $this->findBy($criteres, ['createdAt' => 'DESC']);
    }

    /**
     * @return list<Avis>
     */
    public function findHistoriqueModeration(Ouvrage $ouvrage): array
    {
        $filters = $this->getEntityManager()->getFilters();
        $filters->disable('softdeleteable');

        /** @var list<Avis> $avis */
        $avis = $this->createQueryBuilder('a')
            ->where('a.ouvrage = :ouvrage')
            ->setParameter('ouvrage', $ouvrage)
            ->orderBy('a.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        $filters->enable('softdeleteable');

        return $avis;
    }
}
